// =====================================================================
// Definições do Kanban de Habilitação do Cliente
// =====================================================================

// Ordem das etapas (5 + 1 final). A ordem aqui define a progressão.
export const STAGES_ORDER = [
  'ONBOARDING',
  'CONTRATACAO_SALA',
  'ABERTURA_FILIAL',
  'REATIVACAO_IE',
  'ABERTURA_CONTA_GRAFICA',
  'CONCLUIDO',
];

// Metadata por etapa: rótulo, SLA padrão (em horas), responsável padrão e checklist sugerido
export const STAGE_META = {
  ONBOARDING: {
    label: 'Onboarding',
    slaHours: 24,
    responsibleRole: 'SAYGO',
    defaultChecklist: [
      { label: 'Receber documentos iniciais do cliente',  done: false },
      { label: 'Cadastrar dados básicos no sistema',      done: false },
      { label: 'Apresentar fluxo e responsáveis',         done: false },
    ],
  },
  CONTRATACAO_SALA: {
    label: 'Contratação Sala',
    slaHours: 72,
    responsibleRole: 'PARTNER',
    defaultChecklist: [
      { label: 'Verificar disponibilidade da sala',       done: false },
      { label: 'Emitir contrato de locação',              done: false },
      { label: 'Coletar assinatura do cliente',           done: false },
    ],
  },
  ABERTURA_FILIAL: {
    label: 'Abertura da Filial',
    slaHours: 168, // 7 dias
    responsibleRole: 'PARTNER',
    defaultChecklist: [
      { label: 'Reunir documentação societária',          done: false },
      { label: 'Protocolar abertura na Junta',            done: false },
      { label: 'Receber CNPJ da filial',                  done: false },
    ],
  },
  REATIVACAO_IE: {
    label: 'Reativação da Inscrição Estadual',
    slaHours: 240, // 10 dias
    responsibleRole: 'PARTNER',
    defaultChecklist: [
      { label: 'Solicitar reativação na SEFAZ',           done: false },
      { label: 'Acompanhar análise',                      done: false },
      { label: 'IE ativa publicada',                      done: false },
    ],
  },
  ABERTURA_CONTA_GRAFICA: {
    label: 'Abertura Conta Gráfica',
    slaHours: 120, // 5 dias
    responsibleRole: 'SAYGO',
    defaultChecklist: [
      { label: 'Conta gráfica criada no sistema',         done: false },
      { label: 'Saldo inicial registrado',                done: false },
      { label: 'Cliente notificado',                      done: false },
    ],
  },
  CONCLUIDO: {
    label: 'Concluído',
    slaHours: 0,
    responsibleRole: null,
    defaultChecklist: [],
  },
};

export const STAGE_LABELS = Object.fromEntries(
  Object.entries(STAGE_META).map(([k, v]) => [k, v.label])
);

export function nextStage(stage) {
  const idx = STAGES_ORDER.indexOf(stage);
  if (idx < 0 || idx >= STAGES_ORDER.length - 1) return null;
  return STAGES_ORDER[idx + 1];
}

// Tamanho máximo de upload (em bytes). Postgres bytea aguenta, mas
// queremos manter o banco compacto.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
