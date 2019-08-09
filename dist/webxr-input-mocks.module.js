/**
 * A false gamepad to be used in tests
 */
class MockGamepad {
  /**
   * @param {Object} profileDescription - The profile description to parse to determine the length
   * of the button and axes arrays
   * @param {string} handedness - The gamepad's handedness
   */
  constructor(profileDescription, handedness) {
    if (!profileDescription) {
      throw new Error('No profileDescription supplied');
    }

    if (!handedness) {
      throw new Error('No handedness supplied');
    }

    this.id = profileDescription.id;

    // Loop through the profile description to determine how many elements to put in the buttons
    // and axes arrays
    let maxButtonIndex = 0;
    let maxAxisIndex = 0;
    const handDescription = profileDescription.handedness[handedness];
    handDescription.components.forEach((componentId) => {
      const component = profileDescription.components[componentId];
      const dataSource = profileDescription.dataSources[component.dataSource];

      if (dataSource.buttonIndex && dataSource.buttonIndex > maxButtonIndex) {
        maxButtonIndex = dataSource.buttonIndex;
      }

      if (dataSource.xAxisIndex && (dataSource.xAxisIndex > maxAxisIndex)) {
        maxAxisIndex = dataSource.xAxisIndex;
      }

      if (dataSource.yAxisIndex && (dataSource.yAxisIndex > maxAxisIndex)) {
        maxAxisIndex = dataSource.yAxisIndex;
      }
    });

    // Fill the axes array
    this.axes = [];
    while (this.axes.length <= maxAxisIndex) {
      this.axes.push(0);
    }

    // Fill the buttons array
    this.buttons = [];
    while (this.buttons.length <= maxButtonIndex) {
      this.buttons.push({
        value: 0,
        touched: false,
        pressed: false
      });
    }

    // Set a WebVR property
    if (profileDescription.WebVR) {
      this.hand = handedness;
    }
  }
}

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

/**
 * A fake XRInputSource that can be used to initialize a MotionController. Supports being created
 * from a WebVR style gamepad
 */
class MockXRInputSource {
  /**
   * @param {Object} gamepad - The Gamepad object that provides the button and axis data
   * @param {string} [handedness] - An optional value representing the handedness; not necessary
   * when the supplied gamepad is a WebVR gamepad
   */
  constructor(gamepad, handedness) {
    this.gamepad = gamepad;

    // Check if the gamepad is a WebVR gamepad
    if (this.gamepad.hand) {
      // Convert the WebVR definition of a NONE hand into the WebXR equivalent
      this.handedness = (this.gamepad.hand !== '') ? Constants.Handedness.NONE : this.gamepad.hand;

      // Build a WebXR style profiles array from the WebVR gamepad identification
      this.profiles = Object.freeze([`WebVR ${this.gamepad.id}`]);
    } else {
      // Require a handedness when a true mock
      if (!handedness) {
        throw new Error('No handedness available');
      }

      this.handedness = handedness;
      this.profiles = Object.freeze([this.gamepad.id]);
    }
  }

  getProfiles() {
    return this.profiles;
  }
}

export { MockGamepad, MockXRInputSource };
