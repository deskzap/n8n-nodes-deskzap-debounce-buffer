const path = require('path');
try {
    const nodePath = path.resolve('./dist/nodes/DeskzapDebounceSmartBuffer/DeskzapDebounceSmartBuffer.node.js');
    const nodeModule = require(nodePath);
    console.log('Exports keys:', Object.keys(nodeModule));
    if (nodeModule.DeskzapDebounceSmartBuffer) {
        console.log('Class found!');
        const instance = new nodeModule.DeskzapDebounceSmartBuffer();
        console.log('Instance description:', instance.description);
    } else {
        console.error('Class DeskzapDebounceSmartBuffer NOT found in exports');
    }
} catch (error) {
    console.error('Error loading module:', error);
}
