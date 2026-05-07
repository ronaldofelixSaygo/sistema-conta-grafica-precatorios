// Mantido como shim de compatibilidade. A implementacao real agora esta
// em ./stageDef.service.js. Reexporta o necessario.
export { ensureDefaults, listAll as listConfigs, getStageByKey as getEffectiveConfig } from './stageDef.service.js';
