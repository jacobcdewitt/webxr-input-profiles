import { Profiles } from '../dist/webxr-input-profiles.module.js';
import { MockGamepad, MockXRInputSource } from '../dist/webxr-input-mocks.module.js';
import { PerspectiveCamera, Scene, Color, WebGLRenderer, DirectionalLight, Quaternion, SphereGeometry, MeshBasicMaterial, Mesh } from './three/build/three.module.js';
import { GLTFLoader } from './three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './three/examples/jsm/controls/OrbitControls.js';

const errorsElementId = 'errors';
let listElement;

function toggleVisibility() {
  const errorsElement = document.getElementById(errorsElementId);
  errorsElement.hidden = errorsElement.children.length === 0;
}

function addErrorElement(errorMessage) {
  const errorsElement = document.getElementById(errorsElementId);
  if (!listElement) {
    listElement = document.createElement('ul');
    errorsElement.appendChild(listElement);
  }

  const itemElement = document.createElement('li');
  itemElement.innerText = errorMessage;
  listElement.appendChild(itemElement);

  toggleVisibility();
}

const ErrorLogging = {
  log: (errorMessage) => {
    addErrorElement(errorMessage);

    /* eslint-disable-next-line no-console */
    console.error(errorMessage);
  },

  throw: (errorMessage) => {
    addErrorElement(errorMessage);
    throw new Error(errorMessage);
  },

  clear: () => {
    if (listElement) {
      const errorsElement = document.getElementById(errorsElementId);
      errorsElement.removeChild(listElement);
      listElement = undefined;
    }
    toggleVisibility();
  },

  clearAll: () => {
    const errorsElement = document.getElementById(errorsElementId);
    errorsElement.innerHTML = '';
    listElement = undefined;
    toggleVisibility();
  }
};

/* eslint import/no-unresolved: off */

const three = {};
let canvasParentElement;
let activeModel;

/**
 * @description Attaches a small blue sphere to the point reported as touched on all touchpads
 * @param {Object} model - The model to add dots to
 * @param {Object} motionController - A MotionController to be displayed and animated
 * @param {Object} rootNode - The root node in the asset to be animated
 */
function addTouchDots({ motionController, rootNode }) {
  Object.values(motionController.components).forEach((component) => {
    // Find the touchpads
    if (component.dataSource.dataSourceType === 'touchpadSource') {
      // Find the node to attach the touch dot.
      const componentRoot = rootNode.getObjectByName(component.rootNodeName, true);

      if (!componentRoot) {
        ErrorLogging.log(`Could not find root node of touchpad component ${component.rootNodeName}`);
        return;
      }

      const touchDotRoot = componentRoot.getObjectByName(component.touchDotNodeName, true);

      const sphereGeometry = new SphereGeometry(0.001);
      const material = new MeshBasicMaterial({ color: 0x0000FF });
      const sphere = new Mesh(sphereGeometry, material);
      touchDotRoot.add(sphere);
    }
  });
}

/**
 * @description Walks the model's tree to find the nodes needed to animate the components and
 * saves them for use in the frame loop
 * @param {Object} model - The model to find nodes in
 */
function findNodes(model) {
  const nodes = {};

  // Loop through the components and find the nodes needed for each components' visual responses
  Object.values(model.motionController.components).forEach((component) => {
    const componentRootNode = model.rootNode.getObjectByName(component.rootNodeName, true);
    const componentNodes = {};

    // If the root node cannot be found, skip this component
    if (!componentRootNode) {
      ErrorLogging.log(`Could not find root node of component ${component.rootNodeName}`);
      return;
    }

    // Loop through all the visual responses to be applied to this component
    Object.values(component.visualResponses).forEach((visualResponse) => {
      const visualResponseNodes = {};
      const { rootNodeName, targetNodeName, property } = visualResponse.description;

      // Find the node at the top of the visualization
      if (rootNodeName === component.root) {
        visualResponseNodes.rootNode = componentRootNode;
      } else {
        visualResponseNodes.rootNode = componentRootNode.getObjectByName(rootNodeName, true);
      }

      // If the root node cannot be found, skip this animation
      if (!visualResponseNodes.rootNode) {
        ErrorLogging.log(`Could not find root node of visual response for ${rootNodeName}`);
        return;
      }

      // Find the node to be changed
      visualResponseNodes.targetNode = visualResponseNodes.rootNode.getObjectByName(targetNodeName);

      // If animating a transform, find the two nodes to be interpolated between.
      if (property === 'transform') {
        const { minNodeName, maxNodeName } = visualResponse.description;
        visualResponseNodes.minNode = visualResponseNodes.rootNode.getObjectByName(minNodeName);
        visualResponseNodes.maxNode = visualResponseNodes.rootNode.getObjectByName(maxNodeName);

        // If the extents cannot be found, skip this animation
        if (!visualResponseNodes.minNode || !visualResponseNodes.maxNode) {
          ErrorLogging.log(`Could not find extents nodes of visual response for ${rootNodeName}`);
          return;
        }
      }

      // Add the animation to the component's nodes dictionary
      componentNodes[rootNodeName] = visualResponseNodes;
    });

    // Add the component's animations to the controller's nodes dictionary
    nodes[component.id] = componentNodes;
  });

  return nodes;
}


function clear() {
  if (activeModel) {
    // Remove any existing model from the scene
    three.scene.remove(activeModel.rootNode);

    // Set the page element with controller data for debugging
    const dataElement = document.getElementById('data');
    dataElement.innerHTML = '';

    activeModel = null;
  }

  ErrorLogging.clear();
}
/**
 * @description Event handler for window resizing.
 */
function onResize() {
  const width = canvasParentElement.clientWidth;
  const height = canvasParentElement.clientHeight;
  three.camera.aspectRatio = width / height;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(width, height);
  three.controls.update();
}

/**
 * @description Callback which runs the rendering loop. (Passed into window.requestAnimationFrame)
 */
function animationFrameCallback() {
  window.requestAnimationFrame(animationFrameCallback);

  if (activeModel) {
    // Cause the MotionController to poll the Gamepad for data
    activeModel.motionController.updateFromGamepad();

    // Set the page element with controller data for debugging
    const dataElement = document.getElementById('data');
    dataElement.innerHTML = JSON.stringify(activeModel.motionController.data, null, 2);

    // Update the 3D model to reflect the button, thumbstick, and touchpad state
    Object.values(activeModel.motionController.components).forEach((component) => {
      const componentNodes = activeModel.nodes[component.id];

      // Skip if the component node is not found. No error is needed, because it
      // will have been reported at load time.
      if (!componentNodes) return;

      // Update node data based on the visual responses' current states
      Object.values(component.visualResponses).forEach((visualResponse) => {
        const { description, value } = visualResponse;
        const visualResponseNodes = componentNodes[description.rootNodeName];

        // Skip if the visual response node is not found. No error is needed,
        // because it will have been reported at load time.
        if (!visualResponseNodes) return;

        // Calculate the new properties based on the weight supplied
        if (description.property === 'visibility') {
          visualResponseNodes.targetNode.visible = value;
        } else if (description.property === 'transform') {
          Quaternion.slerp(
            visualResponseNodes.minNode.quaternion,
            visualResponseNodes.maxNode.quaternion,
            visualResponseNodes.targetNode.quaternion,
            value
          );

          visualResponseNodes.targetNode.position.lerpVectors(
            visualResponseNodes.minNode.position,
            visualResponseNodes.maxNode.position,
            value
          );
        }
      });
    });
  }

  three.renderer.render(three.scene, three.camera);
  three.controls.update();
}

const ModelViewer = {
  initialize: () => {
    canvasParentElement = document.getElementById('modelViewer');
    const width = canvasParentElement.clientWidth;
    const height = canvasParentElement.clientHeight;

    // Set up the THREE.js infrastructure
    three.camera = new PerspectiveCamera(75, width / height, 0.01, 1000);
    three.camera.position.y = 0.5;
    three.scene = new Scene();
    three.scene.background = new Color(0x00aa44);
    three.renderer = new WebGLRenderer({ antialias: true });
    three.renderer.setSize(width, height);
    three.renderer.gammaOutput = true;
    three.loader = new GLTFLoader();

    // Set up the controls for moving the scene around
    three.controls = new OrbitControls(three.camera, three.renderer.domElement);
    three.controls.enableDamping = true;
    three.controls.minDistance = 0.05;
    three.controls.maxDistance = 0.3;
    three.controls.enablePan = false;
    three.controls.update();

    // Set up the lights so the model can be seen
    const bottomDirectionalLight = new DirectionalLight(0xFFFFFF, 2);
    bottomDirectionalLight.position.set(0, -1, 0);
    three.scene.add(bottomDirectionalLight);
    const topDirectionalLight = new DirectionalLight(0xFFFFFF, 2);
    three.scene.add(topDirectionalLight);

    // Add the THREE.js canvas to the page
    canvasParentElement.appendChild(three.renderer.domElement);
    window.addEventListener('resize', onResize, false);

    // Start pumping frames
    window.requestAnimationFrame(animationFrameCallback);
  },

  loadModel: (motionController, assetPath) => {
    // Remove any existing model from the scene
    clear();

    const onLoad = (gltfAsset) => {
      const model = {
        motionController,
        rootNode: gltfAsset.scene
      };

      model.nodes = findNodes(model);
      addTouchDots(model);

      // Set the new model
      activeModel = model;
      three.scene.add(activeModel.rootNode);
    };

    const onError = () => {
      ErrorLogging.throw(
        `Asset failed to load either because it was missing or malformed. ${motionController.assetPath}`
      );
    };

    three.loader.load(
      (assetPath) || motionController.assetPath,
      onLoad,
      null,
      onError
    );
  },

  clear
};

/* eslint import/no-unresolved: off */

let controlsListElement;
let mockXRInputSource;
let motionController;

function onButtonTouched(event) {
  const { index } = event.target.dataset;
  mockXRInputSource.gamepad.buttons[index].touched = event.target.checked;
}

function onButtonPressed(event) {
  const { index } = event.target.dataset;
  mockXRInputSource.gamepad.buttons[index].pressed = event.target.checked;
}

function onButtonValueChange(event) {
  const { index } = event.target.dataset;
  mockXRInputSource.gamepad.buttons[index].value = Number(event.target.value);
}

function onAxisValueChange(event) {
  const { index } = event.target.dataset;
  mockXRInputSource.gamepad.axes[index] = Number(event.target.value);
}

function clear$1() {
  if (!controlsListElement) {
    controlsListElement = document.getElementById('controlsList');
  }
  controlsListElement.innerHTML = '';
  motionController = undefined;
  mockXRInputSource = undefined;
}

function build(controller) {
  clear$1();

  motionController = controller;
  mockXRInputSource = motionController.xrInputSource;

  Object.values(motionController.components).forEach((component) => {
    const { buttonIndex } = component.dataSource;
    const { xAxisIndex } = component.dataSource;
    const { yAxisIndex } = component.dataSource;
    const hasAxes = (xAxisIndex !== undefined && yAxisIndex !== undefined);

    let innerHtml = `
      <h4>Component ${component.id}</h4>
    `;

    if (buttonIndex !== undefined) {
      innerHtml += `
      <label>buttonValue<label>
      <input id="buttonValue${buttonIndex}" data-index="${buttonIndex}" type="range" min="0" max="1" step="0.01" value="0">
      
      <label>touched</label>
      <input id="buttonTouched${buttonIndex}" data-index="${buttonIndex}" type="checkbox">

      <label>pressed</label>
      <input id="buttonPressed${buttonIndex}" data-index="${buttonIndex}" type="checkbox">
      `;
    }

    if (hasAxes) {
      innerHtml += `
      <br/>
      <label>xAxis<label>
      <input id="axis${xAxisIndex}" data-index="${xAxisIndex}"
             type="range" min="-1" max="1" step="0.01" value="0">
      <label>yAxis<label>
      <input id="axis${yAxisIndex}" data-index="${yAxisIndex}"
             type="range" min="-1" max="1" step="0.01" value="0">
    `;
    }

    const listElement = document.createElement('li');
    listElement.setAttribute('class', 'component');
    listElement.innerHTML = innerHtml;
    controlsListElement.appendChild(listElement);

    if (buttonIndex !== undefined) {
      document.getElementById(`buttonValue${buttonIndex}`).addEventListener('input', onButtonValueChange);
      document.getElementById(`buttonTouched${buttonIndex}`).addEventListener('click', onButtonTouched);
      document.getElementById(`buttonPressed${buttonIndex}`).addEventListener('click', onButtonPressed);
    }

    if (hasAxes) {
      document.getElementById(`axis${xAxisIndex}`).addEventListener('input', onAxisValueChange);
      document.getElementById(`axis${yAxisIndex}`).addEventListener('input', onAxisValueChange);
    }
  });
}

var ManualControls = { clear: clear$1, build };

/* eslint import/no-unresolved: off */

const profiles = new Profiles('../dist/profiles');

let supportedProfilesList;
let activeProfile;
let customProfileAssets = {};
const pageElements = {};

function clear$2(saveProfile) {
  ErrorLogging.clearAll();
  ModelViewer.clear();
  ManualControls.clear();
  if (!saveProfile) {
    activeProfile = undefined;
    customProfileAssets = {};
  }
}

function ensureInteractionDisabled() {
  pageElements.profileSelector.disabled = true;
  pageElements.handednessSelector.disabled = true;
  pageElements.fileNamesSelector.disabled = true;
}

function enableInteraction() {
  pageElements.profileSelector.disabled = false;
  pageElements.handednessSelector.disabled = false;
  pageElements.fileNamesSelector.disabled = (pageElements.profileSelector.value !== 'custom');
}

function setUrl(profileId, handedness) {
  if (profileId) {
    window.localStorage.setItem('profileId', profileId);
  } else {
    window.localStorage.removeItem('profileId');
  }

  if (handedness) {
    window.localStorage.setItem('handedness', handedness);
  } else {
    window.localStorage.removeItem('handedness');
  }
}

function onHandednessSelected() {
  ensureInteractionDisabled();
  setUrl(pageElements.profileSelector.value, pageElements.handednessSelector.value);
  clear$2(/* saveProfile */ true);

  // Create a mock gamepad that matches the profile and handedness
  const handedness = pageElements.handednessSelector.value;
  const mockGamepad = new MockGamepad(activeProfile, handedness);
  const mockXRInputSource = new MockXRInputSource(mockGamepad, handedness);
  if (pageElements.profileSelector.value === 'custom') {
    const motionController = Profiles.createCustomMotionController(
      mockXRInputSource, activeProfile
    );
    ManualControls.build(motionController);
    ModelViewer.loadModel(motionController, customProfileAssets[motionController.assetPath]);
    enableInteraction();
  } else {
    profiles.createMotionController(mockXRInputSource).then((motionController) => {
      ManualControls.build(motionController);
      ModelViewer.loadModel(motionController);
    }).finally(() => {
      enableInteraction();
    });
  }
}

function onProfileLoaded(profile, localStorageHandedness) {
  ensureInteractionDisabled();

  activeProfile = profile;

  // Populate handedness selector
  pageElements.handednessSelector.innerHTML = '';
  Object.keys(activeProfile.handedness).forEach((handedness) => {
    pageElements.handednessSelector.innerHTML += `
      <option value='${handedness}'>${handedness}</option>
    `;
  });

  // Apply handedness if supplied
  if (localStorageHandedness && activeProfile.handedness[localStorageHandedness]) {
    pageElements.handednessSelector.value = localStorageHandedness;
  }

  // Manually trigger the handedness to change
  onHandednessSelected();
}

function loadCustomFiles(localStorageHandedness) {
  ensureInteractionDisabled();

  let profileFile;
  pageElements.fileNames.innerHTML = '';

  const fileList = Array.from(pageElements.fileNamesSelector.files);
  fileList.forEach((file) => {
    pageElements.fileNames.innerHTML += `
      <li>${file.name}</li>
    `;

    if (file.name === 'profile.json') {
      profileFile = file;
    } else {
      customProfileAssets[file.name] = window.URL.createObjectURL(file);
    }
  });

  if (!profileFile) {
    enableInteraction();
    ErrorLogging.log('No profile.json');
  }

  // Attempt to load the profile
  const reader = new FileReader();

  reader.onload = () => {
    const profile = JSON.parse(reader.result);
    onProfileLoaded(profile, localStorageHandedness);
  };

  reader.onerror = () => {
    enableInteraction();
    ErrorLogging.logAndThrow('Unable to load profile.json');
  };

  reader.readAsText(profileFile);
}

function onProfileIdSelected(localStorageHandedness) {
  // Get the selected profile id
  const profileId = pageElements.profileSelector.value;

  ensureInteractionDisabled();
  clear$2(/* saveProfile */ false);
  setUrl(profileId);

  pageElements.handednessSelector.innerHTML = `
    <option value='loading'>Loading...</option>
  `;

  // Attempt to load the profile
  if (profileId === 'custom') {
    // leave profile/handedness disabled until load complete
    pageElements.customProfile.hidden = false;
    loadCustomFiles(localStorageHandedness);
  } else {
    pageElements.customProfile.hidden = true;
    profiles.fetchProfile([profileId])
      .then((profile) => {
        onProfileLoaded(profile, localStorageHandedness);
      })
      .catch((error) => {
        enableInteraction();
        ErrorLogging.log(error.message);
        throw error;
      });
  }
}

function populateProfileSelector() {
  ensureInteractionDisabled();
  clear$2(/* saveProfile */ false);

  profiles.fetchSupportedProfilesList().then((profilesList) => {
    supportedProfilesList = profilesList;

    // Remove loading entry
    pageElements.profileSelector.innerHTML = '';

    if (supportedProfilesList.length > 0) {
      // Populate the selector with the profiles list
      supportedProfilesList.forEach((supportedProfile) => {
        pageElements.profileSelector.innerHTML += `
        <option value='${supportedProfile}'>${supportedProfile}</option>
        `;
      });
    }

    // Add the custom option at the end of the list
    pageElements.profileSelector.innerHTML += `
      <option value='custom'>Custom</option>
    `;

    // Get the last known state from local storage
    const localStorageProfileId = window.localStorage.getItem('profileId');
    const localStorageHandedness = window.localStorage.getItem('handedness');

    // Override the default selection if values were present in local storage
    if (localStorageProfileId) {
      pageElements.profileSelector.value = localStorageProfileId;
    }

    // Manually trigger profile to load
    onProfileIdSelected(localStorageHandedness);
  });
}

function onLoad() {
  ModelViewer.initialize();

  pageElements.profileSelector = document.getElementById('profileSelector');
  pageElements.handednessSelector = document.getElementById('handednessSelector');
  pageElements.customProfile = document.getElementById('customProfile');
  pageElements.fileNames = document.getElementById('localFileNames');
  pageElements.fileNamesSelector = document.getElementById('localFilesSelector');

  populateProfileSelector();

  pageElements.fileNamesSelector.addEventListener('change', loadCustomFiles);
  pageElements.profileSelector.addEventListener('change', onProfileIdSelected);
  pageElements.handednessSelector.addEventListener('change', onHandednessSelected);
}
window.addEventListener('load', onLoad);
