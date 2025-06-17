// Global collection cache to prevent duplicate lookups
const CollectionCache = {
  cache: new Map(),

  async get(name) {
    if (this.cache.has(name)) {
      console.log('Cache HIT for collection:', name);
      return this.cache.get(name);
    }

    console.log('Cache MISS for collection:', name, '- checking Figma...');
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const existing = collections.find(c => c.name === name);

    if (existing) {
      console.log('Found existing collection in Figma:', name);
      this.cache.set(name, existing);
      return existing;
    }

    console.log('Creating NEW collection:', name);
    const newCollection = figma.variables.createVariableCollection(name);
    this.cache.set(name, newCollection);
    return newCollection;
  },

  clear() {
    console.log('Clearing collection cache');
    this.cache.clear();
  },

  // Refresh cache with current collections
  async refresh() {
    console.log('Refreshing collection cache...');
    this.clear();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    collections.forEach(c => {
      this.cache.set(c.name, c);
      console.log('Cached existing collection:', c.name);
    });
    console.log('Cache refreshed with', collections.length, 'collections');
  }
};

// Fluent API for Figma Variables with FIXED collection management
class FigmaVariableBuilder {
  constructor() {
    this.context = {};
  }

  collection(path) {
    const parsed = this._parsePath(path);
    this.context.collectionName = parsed.collection;
    this.context.folderPath = parsed.folder;
    return this;
  }

  variable(name, type = "COLOR") {
    this.context.variableName = name;
    this.context.variableType = type;
    return this;
  }

  folder(path) {
    this.context.folderPath = path;
    return this;
  }

  hex() {
    const hexColors = Array.prototype.slice.call(arguments);
    this.context.values = hexColors.map(hex => this._hexToRgb(hex));
    return this;
  }

  rgb() {
    const rgbArrays = Array.prototype.slice.call(arguments);
    this.context.values = rgbArrays.map(function(rgb) {
      return { r: rgb[0]/255, g: rgb[1]/255, b: rgb[2]/255 };
    });
    return this;
  }

  numbers() {
    this.context.values = Array.prototype.slice.call(arguments);
    return this;
  }

  strings() {
    this.context.values = Array.prototype.slice.call(arguments);
    return this;
  }

  async build() {
    // Use the shared cache instead of creating own collection
    const collection = await CollectionCache.get(this.context.collectionName);

    const variableName = this.context.folderPath
      ? this.context.folderPath + '/' + this.context.variableName
      : this.context.variableName;

    const variable = await this._getOrCreateVariable(
      variableName,
      collection,
      this.context.variableType
    );

    if (this.context.values) {
      await this._setValues(variable, collection, this.context.values);
    }

    return { variable: variable, collection: collection };
  }

  _parsePath(path) {
    const parts = path.split('/');
    return {
      collection: parts[0],
      folder: parts.length > 1 ? parts.slice(1).join('/') : null
    };
  }

  _hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r: r/255, g: g/255, b: b/255 };
  }

  async _getOrCreateVariable(name, collection, type) {
    const variables = await figma.variables.getLocalVariablesAsync();
    const existing = variables.find(v => v.name === name && v.variableCollectionId === collection.id);
    if (existing) {
      console.log('Found existing variable:', name, 'in collection:', collection.name);
      return existing;
    }
    console.log('Creating new variable:', name, 'in collection:', collection.name);
    return figma.variables.createVariable(name, collection, type);
  }

  async _setValues(variable, collection, values) {
    const promises = values.map(function(value, index) {
      const mode = collection.modes[index];
      return mode ? variable.setValueForMode(mode.modeId, value) : null;
    }).filter(Boolean);

    await Promise.all(promises);
  }
}

// Main $figma API with UNIFIED collection management
const $figma = {
  variable: function() {
    return new FigmaVariableBuilder();
  },

  async spacingSystem(collectionPath, base, factor, anchor) {
    anchor = anchor || "md";
    const parsed = this._parsePath(collectionPath);
    const collectionName = parsed.collection;
    const subfolder = parsed.folder;
    const names = ["3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
    const anchorIndex = names.indexOf(anchor);
    const values = names.map(function(name, i) {
      return base * Math.pow(factor, i - anchorIndex);
    });

    // Use shared cache instead of separate method
    const collection = await CollectionCache.get(collectionName);
    const self = this;

    console.log('Creating spacing system:', collectionPath, 'with', names.length, 'variables');

    return Promise.all(names.map(function(name, i) {
      const variableName = subfolder ? subfolder + '/' + name : name;
      return self._createVariable(variableName, collection, "FLOAT", values[i]);
    }));
  },

  async colorToken(name, collectionPath, hexColors) {
    const parsed = this._parsePath(collectionPath);
    const collectionName = parsed.collection;
    const subfolder = parsed.folder;
    const variableName = subfolder ? subfolder + '/' + name : name;
    const colors = Array.isArray(hexColors) ? hexColors : [hexColors];

    console.log('Creating color token:', variableName, 'in collection:', collectionName);

    // Use the builder but ensure it uses the same cache
    const builder = this.variable().collection(collectionName).variable(variableName, "COLOR");
    builder.hex.apply(builder, colors);
    return builder.build();
  },

  batch: function() {
    const operations = Array.prototype.slice.call(arguments);
    return Promise.all(operations);
  },

  query: {
    async collections() {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      return collections.map(function(c) {
        return {
          id: c.id,
          name: c.name,
          modes: c.modes,
          variables: c.variableIds.length
        };
      });
    },

    async variables() {
      const variables = await figma.variables.getLocalVariablesAsync();
      return variables.map(function(v) {
        return {
          id: v.id,
          name: v.name,
          type: v.resolvedType,
          collection: v.variableCollectionId,
          values: v.valuesByMode,
          folder: v.name.includes('/') ? v.name.split('/').slice(0, -1).join('/') : null
        };
      });
    },

    async all() {
      const collections = await this.collections();
      const variables = await this.variables();
      return { collections: collections, variables: variables };
    }
  },

  _parsePath: function(path) {
    const parts = path.split('/');
    return {
      collection: parts[0],
      folder: parts.length > 1 ? parts.slice(1).join('/') : null
    };
  },

  async _createVariable(name, collection, type, value) {
    const variables = await figma.variables.getLocalVariablesAsync();
    let variable = variables.find(v => v.name === name && v.variableCollectionId === collection.id);

    if (!variable) {
      console.log('Creating variable:', name, 'in collection:', collection.name);
      variable = figma.variables.createVariable(name, collection, type);
    } else {
      console.log('Updating existing variable:', name, 'in collection:', collection.name);
    }

    await variable.setValueForMode(collection.modes[0].modeId, value);
    return variable;
  }
};

// COMPLETELY REWRITTEN handlers with proper sequencing
const handlers = {
  async createDesignSystem() {
    console.log('=== Starting Design System Creation ===');

    // Step 1: Clear and refresh collection cache
    await CollectionCache.refresh();

    console.log('=== Step 1: Creating Spacing Variables ===');

    // Step 2: Create ALL spacing variables in the SAME "Spacing" collection
    // Do this sequentially to avoid race conditions
    await $figma.spacingSystem("Spacing/golden", 16, 1.618, "md");
    console.log('✓ Golden ratio spacing created');

    await $figma.spacingSystem("Spacing/major-third", 16, 1.25, "md");
    console.log('✓ Major third spacing created');

    await $figma.spacingSystem("Spacing/perfect-fourth", 16, 1.333, "md");
    console.log('✓ Perfect fourth spacing created');

    await $figma.spacingSystem("Spacing/major-second", 16, 1.125, "md");
    console.log('✓ Major second spacing created');

    console.log('=== Step 2: Creating Color Variables ===');

    // Step 3: Create ALL color variables in the SAME "Colors" collection
    // Do this sequentially to avoid race conditions
    await $figma.colorToken("main", "Colors/primary", ["#007AFF", "#0A84FF"]);
    console.log('✓ Primary main color created');

    await $figma.colorToken("light", "Colors/primary", ["#66B2FF", "#66B8FF"]);
    console.log('✓ Primary light color created');

    await $figma.colorToken("dark", "Colors/primary", ["#0051D5", "#0056D6"]);
    console.log('✓ Primary dark color created');

    await $figma.colorToken("success", "Colors/semantic", ["#34C759", "#30D158"]);
    console.log('✓ Semantic success color created');

    await $figma.colorToken("warning", "Colors/semantic", ["#FF9500", "#FF9F0A"]);
    console.log('✓ Semantic warning color created');

    await $figma.colorToken("error", "Colors/semantic", ["#FF3B30", "#FF453A"]);
    console.log('✓ Semantic error color created');

    // Step 4: Get final state
    const data = await $figma.query.all();

    console.log('=== Design System Creation Complete ===');
    console.log('Final collections:', data.collections.length);
    console.log('Final variables:', data.variables.length);

    // Log collection summary
    data.collections.forEach(function(collection) {
      console.log('✓ Collection:', collection.name, '- Variables:', collection.variables);
    });

    figma.ui.postMessage({
      type: 'design-system-created',
      collections: data.collections,
      variables: data.variables
    });

    figma.notify('✅ Design system created: ' + data.collections.length + ' collections, ' + data.variables.length + ' variables');
  },

  async getVariables() {
    console.log('=== Getting Variables ===');

    // Refresh cache before querying
    await CollectionCache.refresh();

    const data = await $figma.query.all();

    console.log('Variables query complete:', data.variables.length, 'variables in', data.collections.length, 'collections');

    figma.ui.postMessage({
      type: 'variables-update',
      collections: data.collections,
      variables: data.variables
    });
  },

  createRectangle: function(msg) {
    const rect = figma.createRectangle();
    rect.x = msg.x;
    rect.y = msg.y;
    rect.fills = [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }];
  },

  getSelection: function() {
    const selection = figma.currentPage.selection.map(function(node) {
      return {
        id: node.id,
        name: node.name,
        type: node.type
      };
    });

    figma.ui.postMessage({
      type: 'selection-update',
      selection: selection
    });
  },

  async createCustomSpacing(msg) {
    console.log('Creating custom spacing system:', msg.path);
    await $figma.spacingSystem(msg.path, msg.base, msg.factor, msg.anchor);
    figma.notify('✅ Custom spacing system created');
  }
};

// Error handling decorator
function withErrorHandling(handler, name) {
  return async function(...args) {
    try {
      return await handler.apply(this, args);
    } catch (error) {
      console.error('Error in ' + name + ':', error);
      figma.notify('Error: ' + error.message, { error: true });
      throw error;
    }
  };
}

// Logging decorator
function withLogging(handler, name) {
  return async function(...args) {
    console.log(`Executing ${name} with args:`, args);
    const result = await handler.apply(this, args);
    console.log(`Completed ${name}`);
    return result;
  };
}

// Apply decorators
Object.keys(handlers).forEach(function(key) {
  handlers[key] = withLogging(withErrorHandling(handlers[key], key), key);
});

// Router for message handling
const router = new Map([
  ['get-variables', handlers.getVariables],
  ['create-design-system', handlers.createDesignSystem],
  ['create-rectangle', handlers.createRectangle],
  ['get-selection', handlers.getSelection],
  ['create-custom-spacing', handlers.createCustomSpacing],
  ['close', function() { figma.closePlugin(); }]
]);

// Main execution
if (!figma.command) {
  figma.showUI(__html__, { width: 400, height: 600 });

  figma.ui.onmessage = async function(msg) {
    const handler = router.get(msg.type);
    if (handler) {
      await handler(msg);
    } else {
      console.warn('Unknown message type: ' + msg.type);
    }
  };

  figma.notify("🎨 Design System Builder Ready!", {
    button: {
      text: "Create System",
      action: function() {
        handlers.createDesignSystem();
      }
    }
  });

} else {
  const commands = new Map([
    ['export-selection', function() { console.log('Exporting...'); }],
    ['count-layers', function() { console.log('Counting...'); }]
  ]);

  const command = commands.get(figma.command);
  if (command) {
    command();
  }

  figma.closePlugin();
}
