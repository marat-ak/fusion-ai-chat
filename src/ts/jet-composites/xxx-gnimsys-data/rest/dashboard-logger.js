/**
 * Dashboard Logger
 * Centralized logging system with module-specific log levels using loglevel library
 */
define( ['xxx-gnimsys-data/libs/loglevel.min'], function(log) {
    'use strict';
    
    // Simple logger implementation (temporary fallback)
    /*const SimpleLogger = {
        loggers: new Map(),
        
        getLogger: function(name) {
            if (!this.loggers.has(name)) {
                const logger = {
                    name: name,
                    level: 0,
                    setLevel: function(level) {
                        if (typeof level === 'string') {
                            const levels = { 'SILENT': 0, 'ERROR': 1, 'WARN': 2, 'INFO': 3, 'DEBUG': 4, 'TRACE': 5 };
                            this.level = levels[level.toUpperCase()] || 0;
                        } else {
                            this.level = level;
                        }
                    },
                    error: function(msg, data) { this._log(1, 'ERROR', msg, data); },
                    warn: function(msg, data) { this._log(2, 'WARN', msg, data); },
                    info: function(msg, data) { this._log(3, 'INFO', msg, data); },
                    debug: function(msg, data) { this._log(4, 'DEBUG', msg, data); },
                    trace: function(msg, data) { this._log(5, 'TRACE', msg, data); },
                    _log: function(level, levelName, message, data) {
                        if (this.level >= level) {
                            console.log(`[${this.name}:${levelName}]`, message, data || '');
                        }
                    }
                };
                this.loggers.set(name, logger);
            }
            return this.loggers.get(name);
        }
    };
    
    const log = SimpleLogger;*/

    const LEVELS = {
        SILENT: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4,
        TRACE: 5
    };

    class DashboardLogger {
        // Static singleton instance
        static instance = null;
        
        // Static debug configuration (set by component property)
        static debugConfig = null;
        
        constructor(debugConfig = {}) {
            this.config = debugConfig;
            this.loggers = new Map();
            this.instanceId = debugConfig.instanceId || 'dashboard';
            
            // Set up default configuration
            this.defaultConfig = {
                global: 0,
                modules: {},
                debuggerLevel: 10, // Level at which to trigger debugger
                ...debugConfig
            };
        }

        /**
         * Static method to get singleton instance and return logger for module
         * @param {string} moduleName - Module name (e.g., 'core', 'block.chart', 'data-manager')
         * @param {Object} config - Optional configuration (only used on first call)
         * @returns {Object} Logger instance
         */
        /**
         * Static method to set debug configuration
         * @param {Object} config - Debug configuration object from component property
         */
        static setDebugConfig(config) {
            DashboardLogger.debugConfig = config;
            // Reset instance to use new config
            DashboardLogger.instance = null;
        }
        
        static getLogger(moduleName, config = null) {
            if (!DashboardLogger.instance) {
                // Use static debugConfig if available, otherwise use default or provided config
                const effectiveConfig = DashboardLogger.debugConfig || config || {
                    instanceId: 'dashboard',
                    global: 0,
                    modules: {
                        'core': 4,           // DEBUG level for core
                        'block.chart': 3,    // INFO level for charts 
                        'block.infolet': 3,  // INFO level for infolets
                        'block.table': 3,    // INFO level for tables
                        'block.listview': 3, // INFO level for listview
                        'tab': 0,            // SILENT for tabs
                        'data-manager': 3,   // INFO level for data manager
                        'ui-manager': 2,     // WARN level for UI manager
                        'notifications': 2,   // WARN level for notifications
                        'data-source-loader': 4,
                        'block.complex-infolet': 4
                    },
                    debuggerLevel: 0 // Trigger debugger at level 11+
                };
                
                DashboardLogger.instance = new DashboardLogger(effectiveConfig);
            }
            
            return DashboardLogger.instance.getLogger(moduleName);
        }

        /**
         * Static method to update configuration at runtime
         * @param {Object} newConfig - New configuration to merge
         */
        static updateConfig(newConfig) {
            if (DashboardLogger.instance) {
                DashboardLogger.instance.updateConfig(newConfig);
            }
        }

        /**
         * Static method to get current configuration
         * @returns {Object} Current configuration
         */
        static getConfig() {
            return DashboardLogger.instance ? DashboardLogger.instance.getConfig() : null;
        }

        /**
         * Get logger for specific module
         * @param {string} moduleName - Module name (e.g., 'core', 'block.infolet', 'data-manager')
         * @returns {Object} Logger instance
         */
        getLogger(moduleName) {
            if (!this.loggers.has(moduleName)) {
                // Safety check: ensure log library is available
                let logger;
                if (log && typeof log.getLogger === 'function') {
                    logger = log.getLogger(`${this.instanceId}.${moduleName}`);
                    const level = this._getModuleLevel(moduleName);

                    // Map our numeric levels to loglevel's levels
                    const loglevelNames = ['SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
                    const loglevelName = loglevelNames[level] || 'SILENT';

                    if (logger && typeof logger.setLevel === 'function') {
                        logger.setLevel(loglevelName);
                    }
                } else {
                    // Fallback logger when loglevel library is not available
                    console.warn('loglevel library not available, using console fallback for logger:', moduleName);
                    logger = {
                        error: console.error.bind(console),
                        warn: console.warn.bind(console),
                        info: console.info.bind(console),
                        debug: console.log.bind(console),
                        trace: console.log.bind(console)
                    };
                }

                // Create enhanced logger with our additional features
                const enhancedLogger = this._createEnhancedLogger(logger, moduleName, this._getModuleLevel(moduleName));
                this.loggers.set(moduleName, enhancedLogger);
            }
            return this.loggers.get(moduleName);
        }

        /**
         * Create enhanced logger with additional features
         */
        _createEnhancedLogger(baseLogger, moduleName, level) {
            const self = this;
            
            return {
                // Standard logging methods
                error: (msg, data) => this._logWithEnhancement(baseLogger.error, 1, moduleName, msg, data),
                warn: (msg, data) => this._logWithEnhancement(baseLogger.warn, 2, moduleName, msg, data),
                info: (msg, data) => this._logWithEnhancement(baseLogger.info, 3, moduleName, msg, data),
                debug: (msg, data) => this._logWithEnhancement(baseLogger.debug, 4, moduleName, msg, data),
                trace: (msg, data) => this._logWithEnhancement(baseLogger.trace, 5, moduleName, msg, data),
                
                // Utility methods
                getLevel: () => level,
                getModuleName: () => moduleName,
                
                // Performance timing
                time: (label) => console.time(`[${moduleName}] ${label}`),
                timeEnd: (label) => console.timeEnd(`[${moduleName}] ${label}`),
                
                // Group logging
                group: (label) => { 
                    if (level >= 3) console.group(`[${moduleName}] ${label}`); 
                },
                groupEnd: () => { 
                    if (level >= 3) console.groupEnd(); 
                }
            };
        }

        /**
         * Enhanced logging with additional features
         */
        _logWithEnhancement(logFunction, logLevel, moduleName, message, data) {
            // Check if we should trigger debugger
            if (this.defaultConfig.debuggerLevel && logLevel <= this.defaultConfig.debuggerLevel) {
                debugger;
            }

            // Safety check: fallback to console if logFunction is undefined
            if (!logFunction || typeof logFunction !== 'function') {
                const levelNames = ['SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
                const levelName = levelNames[logLevel] || 'LOG';
                console.log(`[${moduleName}:${levelName}] ${message}`, data || '');
                return;
            }

            // Add timestamp and module context if data is provided
            if (data && typeof data === 'object') {
                const enhancedData = {
                    timestamp: new Date().toISOString(),
                    module: moduleName,
                    instance: this.instanceId,
                    ...data
                };
                logFunction.call(null, message, enhancedData);
            } else {
                logFunction.call(null, message, data || '');
            }
        }

        /**
         * Get log level for specific module
         */
        _getModuleLevel(moduleName) {
            // Check exact module match first
            if (this.defaultConfig.modules && this.defaultConfig.modules[moduleName] !== undefined) {
                return this.defaultConfig.modules[moduleName];
            }
            
            // Check parent modules (e.g., 'block.infolet' -> 'block')
            const parts = moduleName.split('.');
            for (let i = parts.length - 1; i > 0; i--) {
                const parentModule = parts.slice(0, i).join('.');
                if (this.defaultConfig.modules && this.defaultConfig.modules[parentModule] !== undefined) {
                    return this.defaultConfig.modules[parentModule];
                }
            }
            
            // Fall back to global level
            return this.defaultConfig.global || 0;
        }

        /**
         * Update configuration at runtime
         */
        updateConfig(newConfig) {
            this.defaultConfig = { ...this.defaultConfig, ...newConfig };
            
            // Update existing loggers
            for (const [moduleName, logger] of this.loggers.entries()) {
                const level = this._getModuleLevel(moduleName);
                const loglevelNames = ['SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
                const loglevelName = loglevelNames[level] || 'SILENT';
                
                // Update the underlying loglevel logger
                const baseLogger = log.getLogger(`${this.instanceId}.${moduleName}`);
                baseLogger.setLevel(loglevelName);
            }
        }

        /**
         * Get current configuration
         */
        getConfig() {
            return { ...this.defaultConfig };
        }

        /**
         * List all active loggers
         */
        getActiveLoggers() {
            const loggers = [];
            for (const [moduleName, logger] of this.loggers.entries()) {
                loggers.push({
                    module: moduleName,
                    level: logger.getLevel(),
                    levelName: ['SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'][logger.getLevel()]
                });
            }
            return loggers;
        }
    }

    return DashboardLogger;
});