const VariableResolvedDataType = "BOOLEAN" | "COLOR" | "FLOAT" | "STRING";

// For UI mode
if ( !figma.command ) {
  figma.showUI(__html__, { width: 400, height: 600 });

  figma.ui.onmessage = async (msg) => {
    try {
      switch (msg.type) {
      case 'get-variables':
        console.log('get-variables');

        let collection = (await figma.variables.getLocalVariableCollectionsAsync()).find(c => c.name === "My Collection");
        if (!collection) {
          collection = figma.variables.createVariableCollection("My Collection");
        }
        let all_variables = await figma.variables.getLocalVariablesAsync();

        let newVariable = all_variables.find(v => v.name === "group1/brandColor" && v.variableCollectionId === collection.id);
        if (!newVariable) {
          newVariable = figma.variables.createVariable("group1/brandColor", collection, "COLOR");
        }

        // newVariable.setPluginData(key: string, value: string)

        await newVariable.setValueForMode(collection.modes[0].modeId, { r: 1, g: 0, b: 0 }); // Red in first mode
        // await newVariable.setValueForMode(collection.modes[1].modeId, { r: 0, g: 0, b: 1 }); // Blue in second mode

        const [variables, collections] = await Promise.all([
          figma.variables.getLocalVariablesAsync(),
          figma.variables.getLocalVariableCollectionsAsync()
        ]);

        // Process collections
        const collectionsData = collections.map(collection => ({
          id: collection.id,
          name: collection.name,
          modes: collection.modes,
          variableCount: collection.variableIds.length,
          variableIds: collection.variableIds
        }));

        // Process variables
        const variablesData = variables.map(variable => ({
          id: variable.id,
          name: variable.name,
          type: variable.resolvedType,
          description: variable.description || '',
          scopes: variable.scopes,
          variableCollectionId: variable.variableCollectionId,
          valuesByMode: variable.valuesByMode,
          boundVariables: variable.boundVariables
        }));

        figma.ui.postMessage({
          type: 'variables-update',
          variables: variablesData, collections: collectionsData
        });
        break;
      case 'create-rectangle':
        const rect = figma.createRectangle();
        rect.x = msg.x;
        rect.y = msg.y;
        rect.fills = [{type: 'SOLID', color: {r: 1, g: 0.5, b: 0}}];
        break;
      case 'get-selection':
        const selection = figma.currentPage.selection;
        figma.ui.postMessage({
          type: 'selection-update',
          selection: selection.map(node => ({id: node.id, name: node.name}))
        });
        break;
      case 'close':
        figma.closePlugin();
        break;
      }
    } catch (e) {
      console.log(e)
    }
  }

  // figma.notify("Error: Invalid selection", { error: false });
  figma.notify("Do you want to proceed?", {
    button: {
      text: "Continue",
      action: () => {
        // Your action here
      }
    }
  });

} else { // For query commands
    switch (figma.command) {
      case "export-selection":
        exportSelection();
        break;
      case "count-layers":
        countLayers();
        break;
    }
  figma.closePlugin();
}
