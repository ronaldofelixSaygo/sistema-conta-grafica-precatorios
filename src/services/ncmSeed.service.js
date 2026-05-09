// =====================================================================
// Seed do dataset starter de NCM, anuentes e ICMS por UF.
// Pode ser chamado:
//   - via build do Render (npm run seed:ncm → prisma/seed-ncm.js)
//   - via endpoint admin POST /api/admin/seed-ncm (sob demanda)
// =====================================================================
import { prisma } from '../config/prisma.js';

const UFS = [
  { uf: 'AC', aliq: 19 }, { uf: 'AL', aliq: 19 }, { uf: 'AP', aliq: 18 },
  { uf: 'AM', aliq: 20 }, { uf: 'BA', aliq: 20.5 }, { uf: 'CE', aliq: 20 },
  { uf: 'DF', aliq: 20 }, { uf: 'ES', aliq: 17 }, { uf: 'GO', aliq: 19 },
  { uf: 'MA', aliq: 22 }, { uf: 'MT', aliq: 17 }, { uf: 'MS', aliq: 17 },
  { uf: 'MG', aliq: 18 }, { uf: 'PA', aliq: 19 }, { uf: 'PB', aliq: 20 },
  { uf: 'PR', aliq: 19.5 }, { uf: 'PE', aliq: 20.5 }, { uf: 'PI', aliq: 21 },
  { uf: 'RJ', aliq: 22 }, { uf: 'RN', aliq: 18 }, { uf: 'RS', aliq: 17 },
  { uf: 'RO', aliq: 19.5 }, { uf: 'RR', aliq: 20 }, { uf: 'SC', aliq: 17 },
  { uf: 'SP', aliq: 18 }, { uf: 'SE', aliq: 19 }, { uf: 'TO', aliq: 20 },
];

const NCMS = [
  // Capítulo 84 — Máquinas e equipamentos mecânicos
  { ncm: '84', descricao: 'Reatores, caldeiras, máquinas, aparelhos e instrumentos mecânicos', ii_aliq: 14, ipi_aliq: 5 },
  { ncm: '8471', descricao: 'Máquinas automáticas para processamento de dados (computadores)', ii_aliq: 16, ipi_aliq: 0 },
  { ncm: '847130', descricao: 'Notebooks e laptops', ii_aliq: 16, ipi_aliq: 0 },
  { ncm: '847150', descricao: 'Servidores e desktops', ii_aliq: 16, ipi_aliq: 0 },
  // Capítulo 85 — Equipamentos elétricos e eletrônicos
  { ncm: '85', descricao: 'Máquinas, aparelhos e materiais elétricos', ii_aliq: 14, ipi_aliq: 5 },
  { ncm: '8504', descricao: 'Transformadores e conversores elétricos', ii_aliq: 14, ipi_aliq: 5 },
  { ncm: '850440', descricao: 'Conversores estáticos (UPS, fontes)', ii_aliq: 14, ipi_aliq: 8 },
  { ncm: '8517', descricao: 'Aparelhos para telecomunicações', ii_aliq: 16, ipi_aliq: 5 },
  { ncm: '851712', descricao: 'Telefones celulares', ii_aliq: 16, ipi_aliq: 0 },
  { ncm: '851762', descricao: 'Equipamentos de transmissão/recepção (radioenlaces, switches)', ii_aliq: 16, ipi_aliq: 5 },
  { ncm: '85176259', descricao: 'Outros aparelhos para transmissão/recepção', ii_aliq: 16, ipi_aliq: 5 },
  { ncm: '85176277', descricao: 'Antenas e refletores parabólicos para radioenlace', ii_aliq: 16, ipi_aliq: 5 },
  { ncm: '8528', descricao: 'Monitores e projetores; aparelhos receptores de TV', ii_aliq: 20, ipi_aliq: 15 },
  { ncm: '8543', descricao: 'Máquinas e aparelhos elétricos com função própria', ii_aliq: 14, ipi_aliq: 8 },
  // Capítulo 90 — Instrumentos e aparelhos de medida
  { ncm: '90', descricao: 'Instrumentos óticos, de medida, controle, precisão', ii_aliq: 16, ipi_aliq: 5 },
  { ncm: '9018', descricao: 'Instrumentos médico-cirúrgicos', ii_aliq: 14, ipi_aliq: 0 },
  { ncm: '9027', descricao: 'Instrumentos de análise física/química', ii_aliq: 14, ipi_aliq: 5 },
  // Capítulo 30 — Produtos farmacêuticos
  { ncm: '30', descricao: 'Produtos farmacêuticos', ii_aliq: 0, ipi_aliq: 0 },
  { ncm: '3004', descricao: 'Medicamentos para uso humano', ii_aliq: 0, ipi_aliq: 0 },
  // Capítulo 22 — Bebidas
  { ncm: '22', descricao: 'Bebidas, líquidos alcoólicos e vinagres', ii_aliq: 20, ipi_aliq: 30 },
  // Capítulo 1-15 — Animais, vegetais, alimentos
  { ncm: '01', descricao: 'Animais vivos', ii_aliq: 4, ipi_aliq: 0 },
  { ncm: '02', descricao: 'Carnes e miudezas comestíveis', ii_aliq: 10, ipi_aliq: 0 },
  { ncm: '04', descricao: 'Leite e laticínios; ovos; mel', ii_aliq: 12, ipi_aliq: 0 },
  { ncm: '08', descricao: 'Frutas e cascas frescas/secas', ii_aliq: 10, ipi_aliq: 0 },
  { ncm: '09', descricao: 'Café, chá, mate, especiarias', ii_aliq: 10, ipi_aliq: 0 },
  { ncm: '10', descricao: 'Cereais', ii_aliq: 8, ipi_aliq: 0 },
  // Capítulo 27 — Combustíveis
  { ncm: '27', descricao: 'Combustíveis minerais, óleos e ceras', ii_aliq: 0, ipi_aliq: 0 },
  // Capítulo 39 — Plásticos
  { ncm: '39', descricao: 'Plásticos e suas obras', ii_aliq: 14, ipi_aliq: 5 },
  // Capítulo 48 — Papel
  { ncm: '48', descricao: 'Papel, cartão e suas obras', ii_aliq: 12, ipi_aliq: 0 },
  // Capítulo 61-63 — Têxteis confeccionados
  { ncm: '61', descricao: 'Vestuário de malha', ii_aliq: 35, ipi_aliq: 0 },
  { ncm: '62', descricao: 'Vestuário, exceto de malha', ii_aliq: 35, ipi_aliq: 0 },
  // Capítulo 71 — Pedras preciosas, metais preciosos
  { ncm: '71', descricao: 'Pedras e metais preciosos, joias', ii_aliq: 18, ipi_aliq: 5 },
  // Capítulo 72-73 — Ferro e aço
  { ncm: '72', descricao: 'Ferro fundido, ferro e aço', ii_aliq: 12, ipi_aliq: 0 },
  { ncm: '73', descricao: 'Obras de ferro fundido, ferro ou aço', ii_aliq: 14, ipi_aliq: 5 },
  // Capítulo 87 — Veículos
  { ncm: '87', descricao: 'Veículos automóveis e suas partes', ii_aliq: 35, ipi_aliq: 13 },
  { ncm: '8703', descricao: 'Automóveis de passageiros', ii_aliq: 35, ipi_aliq: 13 },
  { ncm: '8711', descricao: 'Motocicletas', ii_aliq: 35, ipi_aliq: 13 },
  // Capítulo 93 — Armas
  { ncm: '93', descricao: 'Armas e munições', ii_aliq: 20, ipi_aliq: 30 },
  // Capítulo 95 — Brinquedos e artigos esportivos
  { ncm: '95', descricao: 'Brinquedos, jogos e artigos esportivos', ii_aliq: 20, ipi_aliq: 5 },
];

const ANUENTES = [
  { ncm: '8517',   anuente: 'ANATEL',   descricao: 'Certificação obrigatória para equipamentos de telecomunicações' },
  { ncm: '8525',   anuente: 'ANATEL',   descricao: 'Aparelhos transmissores' },
  { ncm: '8526',   anuente: 'ANATEL',   descricao: 'Aparelhos de radiodetecção e radiogoniometria' },
  { ncm: '8527',   anuente: 'ANATEL',   descricao: 'Aparelhos receptores para radiodifusão' },
  { ncm: '8528',   anuente: 'ANATEL',   descricao: 'Monitores e receptores de TV' },
  { ncm: '30',     anuente: 'ANVISA',   descricao: 'Medicamentos e insumos farmacêuticos' },
  { ncm: '3001',   anuente: 'ANVISA',   descricao: 'Glândulas e órgãos para uso opoterápico' },
  { ncm: '3002',   anuente: 'ANVISA',   descricao: 'Sangue humano, soros, vacinas' },
  { ncm: '3003',   anuente: 'ANVISA',   descricao: 'Medicamentos não acondicionados em doses' },
  { ncm: '3004',   anuente: 'ANVISA',   descricao: 'Medicamentos em doses' },
  { ncm: '3006',   anuente: 'ANVISA',   descricao: 'Preparações e artigos farmacêuticos' },
  { ncm: '9018',   anuente: 'ANVISA',   descricao: 'Instrumentos e aparelhos médico-cirúrgicos' },
  { ncm: '9019',   anuente: 'ANVISA',   descricao: 'Aparelhos de mecanoterapia/massagem' },
  { ncm: '9020',   anuente: 'ANVISA',   descricao: 'Aparelhos respiratórios e máscaras' },
  { ncm: '9021',   anuente: 'ANVISA',   descricao: 'Artigos e aparelhos ortopédicos, próteses' },
  { ncm: '9022',   anuente: 'ANVISA',   descricao: 'Aparelhos de raios X e radiação' },
  { ncm: '3303',   anuente: 'ANVISA',   descricao: 'Perfumes e águas de toucador' },
  { ncm: '3304',   anuente: 'ANVISA',   descricao: 'Cosméticos' },
  { ncm: '3305',   anuente: 'ANVISA',   descricao: 'Preparações capilares' },
  { ncm: '3306',   anuente: 'ANVISA',   descricao: 'Preparações para higiene bucal' },
  { ncm: '01',     anuente: 'MAPA',     descricao: 'Animais vivos' },
  { ncm: '02',     anuente: 'MAPA',     descricao: 'Carnes' },
  { ncm: '03',     anuente: 'MAPA',     descricao: 'Peixes e crustáceos' },
  { ncm: '04',     anuente: 'MAPA',     descricao: 'Laticínios e ovos' },
  { ncm: '05',     anuente: 'MAPA',     descricao: 'Outros produtos de origem animal' },
  { ncm: '06',     anuente: 'MAPA',     descricao: 'Plantas vivas' },
  { ncm: '07',     anuente: 'MAPA',     descricao: 'Produtos hortícolas' },
  { ncm: '08',     anuente: 'MAPA',     descricao: 'Frutas' },
  { ncm: '09',     anuente: 'MAPA',     descricao: 'Café, chá, especiarias' },
  { ncm: '10',     anuente: 'MAPA',     descricao: 'Cereais' },
  { ncm: '11',     anuente: 'MAPA',     descricao: 'Produtos da indústria de moagem' },
  { ncm: '12',     anuente: 'MAPA',     descricao: 'Sementes e frutos oleaginosos' },
  { ncm: '22',     anuente: 'MAPA',     descricao: 'Bebidas alcoólicas (vinhos, destilados)' },
  { ncm: '22',     anuente: 'ANVISA',   descricao: 'Bebidas — controle sanitário' },
  { ncm: '27',     anuente: 'ANP',      descricao: 'Combustíveis e derivados de petróleo' },
  { ncm: '38',     anuente: 'IBAMA',    descricao: 'Produtos químicos diversos (controle ambiental)' },
  { ncm: '2903',   anuente: 'IBAMA',    descricao: 'Substâncias controladas (Protocolo Montreal)' },
  { ncm: '8703',   anuente: 'INMETRO',  descricao: 'Automóveis — certificação' },
  { ncm: '8711',   anuente: 'INMETRO',  descricao: 'Motocicletas — certificação' },
  { ncm: '4011',   anuente: 'INMETRO',  descricao: 'Pneus novos — certificação' },
  { ncm: '850440', anuente: 'INMETRO',  descricao: 'Conversores estáticos (UPS, fontes)' },
  { ncm: '8516',   anuente: 'INMETRO',  descricao: 'Aparelhos elétricos de aquecimento' },
  { ncm: '93',     anuente: 'EXERCITO', descricao: 'Armas, munições e produtos controlados' },
  { ncm: '95',     anuente: 'INMETRO',  descricao: 'Brinquedos — certificação compulsória' },
  { ncm: '61',     anuente: 'INMETRO',  descricao: 'Etiquetagem têxtil compulsória', obrigatorio: false },
  { ncm: '62',     anuente: 'INMETRO',  descricao: 'Etiquetagem têxtil compulsória', obrigatorio: false },
];

export async function runNcmSeed({ resetAnuentes = true } = {}) {
  const out = { ufs: 0, ncms: 0, anuentes: 0 };

  // ICMS UF — upsert (idempotente)
  for (const u of UFS) {
    await prisma.icmsUf.upsert({
      where: { uf: u.uf },
      create: u,
      update: { aliq: u.aliq },
    });
    out.ufs++;
  }

  // NCMs — upsert (mantém customizações se existirem)
  for (const n of NCMS) {
    const ncm = String(n.ncm).replace(/\D/g, '');
    await prisma.ncmTributo.upsert({
      where: { ncm },
      create: {
        ncm,
        descricao: n.descricao,
        ii_aliq: n.ii_aliq ?? 0,
        ipi_aliq: n.ipi_aliq ?? 0,
        pis_aliq: n.pis_aliq ?? 2.1,
        cofins_aliq: n.cofins_aliq ?? 9.65,
      },
      update: {}, // não sobrescreve se já existe
    });
    out.ncms++;
  }

  // Anuentes — recria (dataset puro de referência)
  if (resetAnuentes) {
    await prisma.ncmAnuente.deleteMany({});
  }
  for (const a of ANUENTES) {
    await prisma.ncmAnuente.create({
      data: {
        ncm: String(a.ncm).replace(/\D/g, ''),
        anuente: a.anuente,
        descricao: a.descricao || null,
        obrigatorio: a.obrigatorio !== false,
      },
    });
    out.anuentes++;
  }

  return out;
}

export const NCM_DATASET_INFO = {
  ufs: UFS.length,
  ncms: NCMS.length,
  anuentes: ANUENTES.length,
};
