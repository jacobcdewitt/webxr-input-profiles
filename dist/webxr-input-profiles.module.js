const Constants = {
  Handedness: Object.freeze({
    NONE: 'none',
    LEFT: 'left',
    RIGHT: 'right'
  }),

  ComponentState: Object.freeze({
    DEFAULT: 'default',
    TOUCHED: 'touched',
    PRESSED: 'pressed'
  }),

  DataSourceType: Object.freeze({
    BUTTON: 'buttonSource',
    THUMBSTICK: 'thumbstickSource',
    TOUCHPAD: 'touchpadSource'
  }),

  ButtonTouchThreshold: 0.05,

  AxisTouchThreshold: 0.1
};

/** @constant {Object} */
const defaultComponentData = {
  xAxis: 0,
  yAxis: 0,
  buttonValue: 0,
  state: Constants.ComponentState.DEFAULT
};

/**
 * @description Converts an X, Y coordinate from the range -1 to 1 (as reported by the Gamepad
 * API) to the range 0 to 1 (for interpolation). Also caps the X, Y values to be bounded within
 * a circle. This ensures that thumbsticks are not animated outside the bounds of their physical
 * range of motion and touchpads do not report touch locations off their physical bounds.
 * @param {number} x The original x coordinate in the range -1 to 1
 * @param {number} y The original y coordinate in the range -1 to 1
 */
function normalizeAxes(x, y) {
  let xAxis = x;
  let yAxis = y;

  // Determine if the point is outside the bounds of the circle
  // and, if so, place it on the edge of the circle
  const hypotenuse = Math.sqrt((x * x) + (y * y));
  if (hypotenuse > 1) {
    const theta = Math.atan2(y, x);
    xAxis = Math.cos(theta);
    yAxis = Math.sin(theta);
  }

  // Scale and move the circle so values are in the interpolation range.  The circle's origin moves
  // from (0, 0) to (0.5, 0.5). The circle's radius scales from 1 to be 0.5.
  const result = {
    normalizedXAxis: (xAxis * 0.5) + 0.5,
    normalizedYAxis: (yAxis * 0.5) + 0.5
  };
  return result;
}

/**
 * Contains the description of how the 3D model should visually respond to a specific user input.
 * This is accomplished by initializing the object with the name of a node in the 3D model and
 * property that need to be modified in response to user input, the name of the nodes representing
 * the allowable range of motion, and the name of the input which triggers the change. In response
 * to the named input changing, this object computes the appropriate weighting to use for
 * interpolating between the range of motion nodes.
 */
class VisualResponse {
  constructor(visualResponseDescription) {
    // Copies the description properties into a member attribute for modification
    this.description = Object.assign(visualResponseDescription);

    // Looks for a root node name and sets a default if one is not defined
    if (!this.description.targetNodeName) {
      if (this.description.property === 'visibility') {
        this.description.targetNodeName = this.description.rootNodeName;
      } else {
        this.description.targetNodeName = 'VALUE';
      }
    }

    // Looks for min/max node names and sets defaults if they are not defined
    this.description.maxNodeName = (this.description.maxNodeName) ? this.description.maxNodeName : 'MAX';
    this.description.minNodeName = (this.description.minNodeName) ? this.description.minNodeName : 'MIN';

    // Looks for the property name and sets a default if it is not defined
    this.description.property = (this.description.property) ? this.description.property : 'transform';

    // Initializes the response's current value based on default data
    this.updateFromComponent(defaultComponentData);
  }

  /**
   * Computes the visual response's interpolation weight based on component state
   * @param {Object} component - The component from which to update
   * @param {number} xAxis - The reported X axis value of the component
   * @param {number} yAxis - The reported Y axis value of the component
   * @param {number} buttonValue - The reported value of the component's button
   * @param {string} state - The component's active state
   */
  updateFromComponent({
    xAxis, yAxis, buttonValue, state
  }) {
    const { normalizedXAxis, normalizedYAxis } = normalizeAxes(xAxis, yAxis);
    switch (this.description.source) {
      case 'xAxis':
        this.value = (this.description.states.includes(state)) ? normalizedXAxis : 0.5;
        break;
      case 'yAxis':
        this.value = (this.description.states.includes(state)) ? normalizedYAxis : 0.5;
        break;
      case 'buttonValue':
        this.value = (this.description.states.includes(state)) ? buttonValue : 0;
        break;
      case 'state':
        if (this.description.property === 'visibility') {
          this.value = (this.description.states.includes(state));
        } else {
          this.value = this.description.states.includes(state) ? 1.0 : 0.0;
        }
        break;
      default:
        throw new Error('Unexpected visualResponse source');
    }
  }
}

/**
 * @description The base class of all component types
 */
class Component {
  /**
   * @param {Object} profileDescription - Description of the profile that the component belongs to
   * @param {Object} componentDescription - Description of the component to be created
   */
  constructor(profileDescription, componentDescription) {
    this.componentDescription = componentDescription;
    this.dataSource = profileDescription.dataSources[this.componentDescription.dataSource];
    this.pressUnsupported = this.dataSource.pressUnsupported;
    if (this.dataSource.analogValues || this.dataSource.analogButtonValues) {
      this.analogButtonValues = true;
    }

    // Build all the visual responses for this component
    this.visualResponses = {};
    if (this.componentDescription.visualResponses) {
      this.componentDescription.visualResponses.forEach((visualResponseIndex) => {
        const visualResponseDescription = profileDescription.visualResponses[visualResponseIndex];
        const visualResponse = new VisualResponse(visualResponseDescription);
        this.visualResponses[visualResponseDescription.rootNodeName] = visualResponse;
      });
    }

    // Set default state
    this.state = Constants.ComponentState.DEFAULT;
  }

  /**
   * Update the visual response weights based on the current component data
   */
  updateVisualResponses() {
    Object.values(this.visualResponses).forEach((visualResponse) => {
      visualResponse.updateFromComponent(this);
    });
  }

  get id() {
    return this.dataSource.id;
  }

  get rootNodeName() {
    return this.componentDescription.root;
  }

  get labelNodeName() {
    return this.componentDescription.labelTransform;
  }
}

/**
 * @description Represents a button component
 */
class Button extends Component {
  /**
   * @param {Object} profileDescription - Description of the profile that the component belongs to
   * @param {Object} componentDescription - Description of the component to be created
   */
  constructor(profileDescription, componentDescription) {
    const { dataSourceType } = profileDescription.dataSources[componentDescription.dataSource];
    if (dataSourceType !== Constants.DataSourceType.BUTTON) {
      throw new Error('Button requires a matching dataSource.type');
    }

    super(profileDescription, componentDescription);

    // Set default state
    this.buttonValue = 0;
  }

  /**
   * @description Poll for updated data based on current gamepad state
   * @param {Object} gamepad - The gamepad object from which the component data should be polled
   */
  updateFromGamepad(gamepad) {
    const gamepadButton = gamepad.buttons[this.dataSource.buttonIndex];

    this.buttonValue = gamepadButton.value;
    this.buttonValue = (this.buttonValue < 0) ? 0 : this.buttonValue;
    this.buttonValue = (this.buttonValue > 1) ? 1 : this.buttonValue;

    if (gamepadButton.pressed
       || (this.buttonValue === 1 && !this.dataSource.pressUnsupported)) {
      this.state = Constants.ComponentState.PRESSED;
    } else if (gamepadButton.touched || (this.buttonValue > Constants.ButtonTouchThreshold)) {
      this.state = Constants.ComponentState.TOUCHED;
    } else {
      this.state = Constants.ComponentState.DEFAULT;
    }

    this.updateVisualResponses();
  }

  /**
   * @description Returns a subset of component data for simplified debugging
   */
  get data() {
    const { id, buttonValue, state } = this;
    const data = { id, buttonValue, state };
    return data;
  }
}

/**
 * @description Base class for Thumbsticks and Touchpads
 */
class Axes extends Component {
  /**
   * @param {Object} profileDescription - Description of the profile that the component belongs to
   * @param {Object} componentDescription - Description of the component to be created
   */
  constructor(profileDescription, componentDescription) {
    super(profileDescription, componentDescription);

    this.xAxis = 0;
    this.yAxis = 0;

    this.xAxisInverted = (this.dataSource.webVR_xAxisInverted === true);
    this.yAxisInverted = (this.dataSource.webVR_yAxisInverted === true);

    // https://github.com/immersive-web/webxr/issues/774
    // The thumbstick-controller, touchpad-controller, and
    // touchpad-thumbstick controllers may cause a button to
    // appear that can't be used if the hardware doesn't have one
    if (this.dataSource.buttonIndex !== undefined) {
      this.buttonValue = 0;
    } else {
      this.pressUnsupported = true;
    }
  }

  /**
   * @description Poll for updated data based on current gamepad state
   * @param {Object} gamepad - The gamepad object from which the component data should be polled
   */
  updateFromGamepad(gamepad) {
    // Get and normalize x axis value
    this.xAxis = gamepad.axes[this.dataSource.xAxisIndex];
    this.xAxis = (this.xAxis < -1) ? -1 : this.xAxis;
    this.xAxis = (this.xAxis > 1) ? 1 : this.xAxis;
    this.xAxis = this.xAxisInverted ? this.xAxis * -1 : this.xAxis;

    // Get and normalize y axis value
    this.yAxis = gamepad.axes[this.dataSource.yAxisIndex];
    this.yAxis = (this.yAxis < -1) ? -1 : this.yAxis;
    this.yAxis = (this.yAxis > 1) ? 1 : this.yAxis;
    this.yAxis = this.yAxisInverted ? this.yAxis * -1 : this.yAxis;

    // Get and normalize button value
    let gamepadButton;
    if (this.dataSource.buttonIndex !== undefined) {
      gamepadButton = gamepad.buttons[this.dataSource.buttonIndex];
      this.buttonValue = gamepadButton.value;
      this.buttonValue = (this.buttonValue < 0) ? 0 : this.buttonValue;
      this.buttonValue = (this.buttonValue > 1) ? 1 : this.buttonValue;
    }

    // Set the component state
    this.state = Constants.ComponentState.DEFAULT;
    if (gamepadButton) {
      if (gamepadButton.pressed
        || (this.buttonValue === 1 && !this.dataSource.pressUnsupported)) {
        this.state = Constants.ComponentState.PRESSED;
      } else if (gamepadButton.touched || this.buttonValue > Constants.ButtonTouchThreshold) {
        this.state = Constants.ComponentState.TOUCHED;
      }
    } else if (Math.abs(this.xAxis) > Constants.AxisTouchThreshold
               || Math.abs(this.yAxis) > Constants.AxisTouchThreshold) {
      this.state = Constants.ComponentState.TOUCHED;
    }

    this.updateVisualResponses();
  }

  /**
   * @description Returns a subset of component data for simplified debugging
   */
  get data() {
    const {
      id, xAxis, yAxis, state
    } = this;
    const data = {
      id, xAxis, yAxis, state
    };
    if (this.buttonValue !== undefined) {
      data.buttonValue = this.buttonValue;
    }
    return data;
  }
}

/**
 * @description Represents a Thumbstick component
 */
class Thumbstick extends Axes {
  /**
   * @param {Object} profileDescription - Description of the profile that the component belongs to
   * @param {Object} componentDescription - Description of the component to be created
   */
  constructor(profileDescription, componentDescription) {
    const { dataSourceType } = profileDescription.dataSources[componentDescription.dataSource];
    if (dataSourceType !== Constants.DataSourceType.THUMBSTICK) {
      throw new Error('Thumbstick requires a matching dataSource.type');
    }
    super(profileDescription, componentDescription);
  }
}

/**
 * @description Represents a Touchpad component
 */
class Touchpad extends Axes {
  /**
   * @param {Object} profileDescription - Description of the profile that the component belongs to
   * @param {Object} componentDescription - Description of the component to be created
   */
  constructor(profile, componentDescription) {
    const { dataSourceType } = profile.dataSources[componentDescription.dataSource];
    if (dataSourceType !== Constants.DataSourceType.TOUCHPAD) {
      throw new Error('Touchpad requires a matching dataSource.type');
    }
    super(profile, componentDescription);
  }

  get touchDotNodeName() {
    return this.componentDescription.touchpadDot;
  }
}

/**
  * @description Builds a motion controller with components and visual responses based on the
  * supplied profile description. Data is polled from the xrInputSource's gamepad.
  * @author Nell Waliczek / https://github.com/NellWaliczek
*/
class MotionController {
  /**
   * @param {Object} xrInputSource - The XRInputSource to build the MotionController around
   * @param {Object} profile - The best matched profile description for the supplied xrInputSource
   */
  constructor(xrInputSource, profile) {
    if (!xrInputSource) {
      throw new Error('No xrInputSource supplied');
    }

    if (!profile) {
      throw new Error('No profile supplied');
    }

    this.profile = profile;
    this.xrInputSource = xrInputSource;

    // Build child components as described in the profile description
    this.components = {};
    this.hand = this.profile.handedness[xrInputSource.handedness];
    this.hand.components.forEach((componentIndex) => {
      const componentDescription = this.profile.components[componentIndex];
      const dataSource = this.profile.dataSources[componentDescription.dataSource];
      switch (dataSource.dataSourceType) {
        case Constants.DataSourceType.THUMBSTICK:
          this.components[dataSource.id] = new Thumbstick(profile, componentDescription);
          break;

        case Constants.DataSourceType.TOUCHPAD:
          this.components[dataSource.id] = new Touchpad(profile, componentDescription);
          break;

        case Constants.DataSourceType.BUTTON:
          this.components[dataSource.id] = new Button(profile, componentDescription);
          break;

        default:
          throw new Error(`Unknown data source type: ${dataSource.dataSourceType}`);
      }
    });

    // Initialize components based on current gamepad state
    this.updateFromGamepad();
  }

  get id() {
    return this.profile.id;
  }

  get assetPath() {
    let assetPath;
    if (this.profile.baseUri) {
      assetPath = `${this.profile.baseUri}/${this.hand.asset}`;
    } else {
      assetPath = this.hand.asset;
    }
    return assetPath;
  }

  get gripSpace() {
    return this.xrInputSource.gripSpace;
  }

  get targetRaySpace() {
    return this.xrInputSource.targetRaySpace;
  }

  /**
   * @description Returns a subset of component data for simplified debugging
   */
  get data() {
    const data = [];
    Object.values(this.components).forEach((component) => {
      data.push(component.data);
    });
    return data;
  }

  /**
   * @description Poll for updated data based on current gamepad state
   */
  updateFromGamepad() {
    Object.values(this.components).forEach((component) => {
      component.updateFromGamepad(this.xrInputSource.gamepad);
    });
  }
}

class Profiles {
  /**
   * @description Initializes the class to point to the URI with the profiles and assets
   * @param {string} baseUri - The URI to the folder in which the resources sit
   */
  constructor(baseUri) {
    this.baseUri = baseUri;
  }

  /**
   * @description Static helper function to fetch a JSON file and turn it into a JS object
   * @param {string} uri - File URI to fetch
   */
  static async fetchJsonFile(uri) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(response.statusText);
    } else {
      return response.json();
    }
  }

  /**
   * @description Returns the list of available profiles in the target folder. Fetches the remote
   * list if not already downloaded.
   */
  async fetchSupportedProfilesList() {
    // If the profile list hasn't already been retrieved, attempt to fetch it
    if (!this.profilesList) {
      // If there is no attempt currently in progress, start one
      if (!this.profilesListPromise) {
        this.profilesListPromise = Profiles.fetchJsonFile(`${this.baseUri}/profilesList.json`);
      }

      try {
        // Wait on the results of the fetch
        this.profilesList = await this.profilesListPromise;
      } catch (error) {
        // If the fetch has failed, clear out the promise so another attempt can be made later
        this.profilesListPromise = null;
        throw error;
      }
    }

    return this.profilesList;
  }

  /**
   * @description Fetches the first recognized profile description
   * @param {string[]} profilesToMatch - The list of profiles to attempt to match as reported
   * by the XRInputSource
   */
  async fetchProfile(profilesToMatch) {
    if (!profilesToMatch) {
      throw new Error('No profilesToMatch supplied');
    }

    // Get the list of profiles
    const supportedProfilesList = await this.fetchSupportedProfilesList();

    // Find the relative path to the first requested profile that is recognized
    let relativePath;
    profilesToMatch.some((profileName) => {
      if (supportedProfilesList.includes(profileName)) {
        relativePath = profileName;
      }
      return !!relativePath;
    });

    if (!relativePath) {
      throw new Error('No matching profile name found');
    }

    // Fetch the profile description
    const profileFolder = `${this.baseUri}/${relativePath}`;
    const profile = await Profiles.fetchJsonFile(`${profileFolder}/profile.json`);

    // Add the folder URI to the profile description so the asset can be retrieved
    profile.baseUri = profileFolder;

    return profile;
  }

  /**
   * @description Create a MotionController from an XRInputSource by first fetching the best
   * available profile match
   * @param {Object} xrInputSource - The input source to build a MotionController from
   */
  async createMotionController(xrInputSource) {
    const profile = await this.fetchProfile(xrInputSource.getProfiles());
    const motionController = new MotionController(xrInputSource, profile);
    return motionController;
  }

  /**
   * @description Create a MotionController from an XRInputSource
   * @param {Object} xrInputSource - The input source to build a MotionController from
   * @param {Object} profile - The custom profile to use
   */
  static createCustomMotionController(xrInputSource, profile) {
    const motionController = new MotionController(xrInputSource, profile);
    return motionController;
  }
}

export { Constants, Profiles };
