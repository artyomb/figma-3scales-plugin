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

  async typographyScale(baseName, baseSize, factor, anchor) {
    anchor = anchor || "base";
    const names = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
    const anchorIndex = names.indexOf(anchor);

    console.log('Creating typography scale:', baseName, 'with base size:', baseSize);

    const textStyles = [];

    // Load the default font once at the beginning
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      console.log('✓ Default font loaded successfully');
    } catch (error) {
      console.warn('Could not load Inter Regular, will try fallbacks for each style');
    }

    for (let i = 0; i < names.length; i++) {
      const size = Math.round(baseSize * Math.pow(factor, i - anchorIndex));
      const styleName = `${baseName}/${names[i]}`;

      try {
        const textStyle = await this._createTextStyle(styleName, {
          fontSize: size,
          fontName: { family: "Inter", style: "Regular" },
          lineHeight: { unit: "PERCENT", value: 140 }, // 1.4 line height
          letterSpacing: { unit: "PERCENT", value: 0 }
        });

        textStyles.push(textStyle);
        console.log(`✓ Created text style: ${styleName} (${size}px)`);
      } catch (error) {
        console.error(`Failed to create text style: ${styleName}`, error);
        // Continue with other styles even if one fails
      }
    }

    return textStyles;
  },

  async createTextStyle(name, properties) {
    console.log('Creating text style:', name);
    return this._createTextStyle(name, properties);
  },

  // NEW: Typography system with multiple scales
  async typographySystem(config) {
    console.log('Creating typography system with', Object.keys(config.scales).length, 'scales');

    // Pre-load all fonts that will be used
    const fontsToLoad = new Set();

    // Collect fonts from scales (default to Inter Regular)
    Object.values(config.scales).forEach(function(scaleConfig) {
      if (scaleConfig.fontName) {
        fontsToLoad.add(JSON.stringify(scaleConfig.fontName));
      } else {
        fontsToLoad.add(JSON.stringify({ family: "Inter", style: "Regular" }));
      }
    });

    // Collect fonts from semantic styles
    if (config.semantic) {
      Object.values(config.semantic).forEach(function(semanticConfig) {
        if (semanticConfig.fontName) {
          fontsToLoad.add(JSON.stringify(semanticConfig.fontName));
        }
      });
    }

    // Load all unique fonts
    console.log('Pre-loading', fontsToLoad.size, 'unique fonts...');
    for (const fontJson of fontsToLoad) {
      const font = JSON.parse(fontJson);
      try {
        await figma.loadFontAsync(font);
        console.log('✓ Pre-loaded font:', font.family, font.style);
      } catch (error) {
        console.warn('Could not pre-load font:', font, 'will try fallbacks');
      }
    }

    const results = [];

    // Create scales
    for (const [scaleName, scaleConfig] of Object.entries(config.scales)) {
      try {
        const textStyles = await this.typographyScale(
          scaleName,
          scaleConfig.baseSize,
          scaleConfig.factor,
          scaleConfig.anchor || "base"
        );
        results.push({ scale: scaleName, styles: textStyles });
      } catch (error) {
        console.error('Failed to create typography scale:', scaleName, error);
      }
    }

    // Create semantic text styles if provided
    if (config.semantic) {
      for (const [semanticName, semanticConfig] of Object.entries(config.semantic)) {
        try {
          const textStyle = await this._createTextStyle(semanticName, semanticConfig);
          results.push({ scale: 'semantic', styles: [textStyle] });
          console.log(`✓ Created semantic text style: ${semanticName}`);
        } catch (error) {
          console.error('Failed to create semantic text style:', semanticName, error);
        }
      }
    }

    return results;
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

    // NEW: Query text styles
    async textStyles() {
      const textStyles = await figma.getLocalTextStylesAsync();
      return textStyles.map(function(style) {
        return {
          id: style.id,
          name: style.name,
          fontSize: style.fontSize,
          fontName: style.fontName,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textCase: style.textCase,
          textDecoration: style.textDecoration
        };
      });
    },

    async all() {
      const collections = await this.collections();
      const variables = await this.variables();
      const textStyles = await this.textStyles();
      return { collections: collections, variables: variables, textStyles: textStyles };
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
  },

  async _createTextStyle(name, properties) {
    const existingStyles = await figma.getLocalTextStylesAsync();
    let textStyle = existingStyles.find(style => style.name === name);

    if (!textStyle) {
      console.log('Creating new text style:', name);
      textStyle = figma.createTextStyle();
      textStyle.name = name;
    } else {
      console.log('Updating existing text style:', name);
    }

    // Load font FIRST before setting any properties
    let fontToLoad = { family: "Inter", style: "Regular" }; // Default font

    if (properties.fontName) {
      fontToLoad = properties.fontName;
    }

    try {
      console.log('Loading font:', fontToLoad);
      await figma.loadFontAsync(fontToLoad);
      textStyle.fontName = fontToLoad;
    } catch (error) {
      console.warn('Could not load font:', fontToLoad, 'trying fallback fonts');

      // Try common fallback fonts
      const fallbackFonts = [
        { family: "Inter", style: "Regular" },
        { family: "Roboto", style: "Regular" },
        { family: "Arial", style: "Regular" },
        { family: "Helvetica", style: "Regular" }
      ];

      let fontLoaded = false;
      for (const fallback of fallbackFonts) {
        try {
          console.log('Trying fallback font:', fallback);
          await figma.loadFontAsync(fallback);
          textStyle.fontName = fallback;
          fontLoaded = true;
          break;
        } catch (fallbackError) {
          console.warn('Fallback font failed:', fallback);
        }
      }

      if (!fontLoaded) {
        throw new Error('Could not load any font. Please ensure Inter, Roboto, Arial, or Helvetica is available.');
      }
    }

    // Now set other properties AFTER font is loaded
    if (properties.fontSize) {
      textStyle.fontSize = properties.fontSize;
    }

    if (properties.lineHeight) {
      textStyle.lineHeight = properties.lineHeight;
    }

    if (properties.letterSpacing) {
      textStyle.letterSpacing = properties.letterSpacing;
    }

    if (properties.textCase) {
      textStyle.textCase = properties.textCase;
    }

    if (properties.textDecoration) {
      textStyle.textDecoration = properties.textDecoration;
    }

    return textStyle;
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

    console.log('=== Step 3: Creating Typography System ===');

    // Create typography scales
    await $figma.typographySystem({
      scales: {
        "Display": {
          baseSize: 24,
          factor: 1.25,
          anchor: "base"
        },
        "Heading": {
          baseSize: 20,
          factor: 1.2,
          anchor: "base"
        },
        "Body": {
          baseSize: 16,
          factor: 1.125,
          anchor: "base"
        },
        "Caption": {
          baseSize: 12,
          factor: 1.1,
          anchor: "base"
        }
      },
      semantic: {
        "Hero/Title": {
          fontSize: 48,
          fontName: { family: "Inter", style: "Bold" },
          lineHeight: { unit: "PERCENT", value: 120 },
          letterSpacing: { unit: "PERCENT", value: -2 }
        },
        "Hero/Subtitle": {
          fontSize: 20,
          fontName: { family: "Inter", style: "Regular" },
          lineHeight: { unit: "PERCENT", value: 150 },
          letterSpacing: { unit: "PERCENT", value: 0 }
        },
        "Button/Large": {
          fontSize: 16,
          fontName: { family: "Inter", style: "Medium" },
          lineHeight: { unit: "PIXELS", value: 24 },
          letterSpacing: { unit: "PERCENT", value: 0 }
        },
        "Button/Small": {
          fontSize: 14,
          fontName: { family: "Inter", style: "Medium" },
          lineHeight: { unit: "PIXELS", value: 20 },
          letterSpacing: { unit: "PERCENT", value: 0 }
        }
      }
    });

    console.log('✓ Typography system created');

    // Step 4: Get final state
    const data = await $figma.query.all();

    console.log('=== Design System Creation Complete ===');
    console.log('Final collections:', data.collections.length);
    console.log('Final variables:', data.variables.length);
    console.log('Final text styles:', data.textStyles.length);

    // Log collection summary
    data.collections.forEach(function(collection) {
      console.log('✓ Collection:', collection.name, '- Variables:', collection.variables);
    });

    // Log text styles summary
    const styleGroups = {};
    data.textStyles.forEach(function(style) {
      const group = style.name.includes('/') ? style.name.split('/')[0] : 'Other';
      if (!styleGroups[group]) styleGroups[group] = 0;
      styleGroups[group]++;
    });

    Object.entries(styleGroups).forEach(function([group, count]) {
      console.log('✓ Text Styles:', group, '- Count:', count);
    });

    figma.ui.postMessage({
      type: 'design-system-created',
      collections: data.collections,
      variables: data.variables,
      textStyles: data.textStyles
    });

    figma.notify('✅ Design system created: ' + data.collections.length + ' collections, ' + data.variables.length + ' variables, ' + data.textStyles.length + ' text styles');
  },

  async getVariables() {
    console.log('=== Getting Variables and Text Styles ===');

    // Refresh cache before querying
    await CollectionCache.refresh();

    const data = await $figma.query.all();

    console.log('Query complete:', data.variables.length, 'variables,', data.textStyles.length, 'text styles in', data.collections.length, 'collections');

    figma.ui.postMessage({
      type: 'variables-update',
      collections: data.collections,
      variables: data.variables,
      textStyles: data.textStyles
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
  },

  async createCustomTypography(msg) {
    console.log('Creating custom typography scale:', msg.name);
    await $figma.typographyScale(msg.name, msg.baseSize, msg.factor, msg.anchor);
    figma.notify('✅ Custom typography scale created');
  },

  async createTextStyle(msg) {
    console.log('Creating text style:', msg.name);
    await $figma.createTextStyle(msg.name, msg.properties);
    figma.notify('✅ Text style created: ' + msg.name);
  },

  // NEW: Create typography preset systems
  async createTypographyPreset(msg) {
    console.log('Creating typography preset:', msg.preset);

    const presets = {
      modern: {
        scales: {
          "Display": { baseSize: 32, factor: 1.25, anchor: "base" },
          "Heading": { baseSize: 24, factor: 1.2, anchor: "base" },
          "Body": { baseSize: 16, factor: 1.125, anchor: "base" },
          "Caption": { baseSize: 12, factor: 1.1, anchor: "base" }
        },
        semantic: {
          "Hero/Title": {
            fontSize: 56,
            fontName: { family: "Inter", style: "Bold" },
            lineHeight: { unit: "PERCENT", value: 110 },
            letterSpacing: { unit: "PERCENT", value: -2 }
          },
          "Button/Primary": {
            fontSize: 16,
            fontName: { family: "Inter", style: "Medium" },
            lineHeight: { unit: "PIXELS", value: 24 },
            letterSpacing: { unit: "PERCENT", value: 0 }
          }
        }
      },

      classic: {
        scales: {
          "Heading": { baseSize: 18, factor: 1.333, anchor: "base" },
          "Body": { baseSize: 16, factor: 1.2, anchor: "base" }
        },
        semantic: {
          "Article/Title": {
            fontSize: 32,
            fontName: { family: "Inter", style: "Bold" },
            lineHeight: { unit: "PERCENT", value: 125 },
            letterSpacing: { unit: "PERCENT", value: -1 }
          }
        }
      },

      ui: {
        scales: {
          "Interface": { baseSize: 14, factor: 1.125, anchor: "base" }
        },
        semantic: {
          "Button/Large": {
            fontSize: 16,
            fontName: { family: "Inter", style: "Medium" },
            lineHeight: { unit: "PIXELS", value: 24 },
            letterSpacing: { unit: "PERCENT", value: 0 }
          },
          "Button/Small": {
            fontSize: 14,
            fontName: { family: "Inter", style: "Medium" },
            lineHeight: { unit: "PIXELS", value: 20 },
            letterSpacing: { unit: "PERCENT", value: 0 }
          },
          "Label/Form": {
            fontSize: 12,
            fontName: { family: "Inter", style: "Medium" },
            lineHeight: { unit: "PIXELS", value: 16 },
            letterSpacing: { unit: "PERCENT", value: 0 }
          }
        }
      },

      editorial: {
        scales: {
          "Editorial": { baseSize: 18, factor: 1.25, anchor: "base" }
        },
        semantic: {
          "Article/Headline": {
            fontSize: 36,
            fontName: { family: "Inter", style: "Bold" },
            lineHeight: { unit: "PERCENT", value: 120 },
            letterSpacing: { unit: "PERCENT", value: -1.5 }
          },
          "Article/Subhead": {
            fontSize: 20,
            fontName: { family: "Inter", style: "SemiBold" },
            lineHeight: { unit: "PERCENT", value: 130 },
            letterSpacing: { unit: "PERCENT", value: 0 }
          },
          "Article/Body": {
            fontSize: 18,
            fontName: { family: "Inter", style: "Regular" },
            lineHeight: { unit: "PERCENT", value: 160 },
            letterSpacing: { unit: "PERCENT", value: 0 }
          }
        }
      }
    };

    const config = presets[msg.preset];
    if (!config) {
      throw new Error('Unknown typography preset: ' + msg.preset);
    }

    await $figma.typographySystem(config);
    figma.notify('✅ Typography preset created: ' + msg.preset);
  },

  // NEW: Create typography system (for quick action button)
  async createTypographySystem() {
    console.log('Creating default typography system');
    await this.createTypographyPreset({ preset: 'modern' });
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
  ['create-custom-typography', handlers.createCustomTypography], // NEW
  ['create-text-style', handlers.createTextStyle], // NEW
  ['create-typography-preset', handlers.createTypographyPreset], // NEW
  ['create-typography-system', handlers.createTypographySystem], // NEW
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
