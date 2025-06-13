figma.showUI(__html__, { width: 400, height: 600 });

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
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
};