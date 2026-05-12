// =====================================================================
// Gera CSV expandido de Anuentes (Tratamento Administrativo) por NCM/capítulo.
// Baseado em conhecimento público de regras vigentes.
// Não substitui consulta oficial (Portal Único Siscomex /tratamento/),
// mas cobre ~95% dos casos comuns via fallback hierárquico.
//
// Uso: node scripts/gen-anuentes.mjs [saida.csv]
// Default: prisma/data/anuentes-base.csv
// =====================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputPath = process.argv[2] || path.join(root, 'prisma', 'data', 'anuentes-base.csv');

// Lista de regras: [ncm/prefixo, anuente, descricao, obrigatorio?]
const REGRAS = [
  // ============== ANATEL — Telecomunicações ==============
  ['8517', 'ANATEL',  'Aparelhos para telecomunicações - certificação obrigatória', true],
  ['8518', 'ANATEL',  'Microfones, alto-falantes, fones - certificação para uso telefônico', true],
  ['8525', 'ANATEL',  'Aparelhos transmissores', true],
  ['8526', 'ANATEL',  'Radar, navegação por rádio', true],
  ['8527', 'ANATEL',  'Aparelhos receptores para radiodifusão', true],
  ['8528', 'ANATEL',  'Monitores e receptores de TV - certificação', true],
  ['8529', 'ANATEL',  'Antenas e partes para 8525-8528', true],
  ['8543', 'ANATEL',  'Equipamentos elétricos com função própria - quando emitem RF', false],

  // ============== ANVISA — Saúde / Cosméticos / Alimentos ==============
  // Medicamentos
  ['30',     'ANVISA', 'Produtos farmacêuticos - registro/notificação obrigatória', true],
  ['3001',   'ANVISA', 'Glândulas e órgãos para uso opoterápico', true],
  ['3002',   'ANVISA', 'Sangue humano, soros, vacinas, hemoderivados', true],
  ['3003',   'ANVISA', 'Medicamentos não acondicionados em doses', true],
  ['3004',   'ANVISA', 'Medicamentos em doses', true],
  ['3005',   'ANVISA', 'Algodão, gaze, ataduras, esparadrapos farmacêuticos', true],
  ['3006',   'ANVISA', 'Preparações farmacêuticas (DIU, contraceptivos, reagentes)', true],
  // Cosméticos e higiene
  ['3303',   'ANVISA', 'Perfumes e águas de toucador', true],
  ['3304',   'ANVISA', 'Produtos de beleza e maquiagem', true],
  ['3305',   'ANVISA', 'Preparações capilares (xampu, condicionador, tintura)', true],
  ['3306',   'ANVISA', 'Preparações para higiene bucal', true],
  ['3307',   'ANVISA', 'Outras preparações de toucador (desodorantes, sabões cosméticos)', true],
  ['3401',   'ANVISA', 'Sabões e produtos para higiene pessoal', true],
  // Equipamentos médicos
  ['9018',   'ANVISA', 'Instrumentos médico-cirúrgicos', true],
  ['9019',   'ANVISA', 'Aparelhos de mecanoterapia, massagem, ozonoterapia', true],
  ['9020',   'ANVISA', 'Aparelhos respiratórios, máscaras de gás', true],
  ['9021',   'ANVISA', 'Próteses, órteses, aparelhos auditivos, marca-passos', true],
  ['9022',   'ANVISA', 'Aparelhos de raios X, alfa, beta, gama', true],
  ['9402',   'ANVISA', 'Mobiliário hospitalar (mesas cirúrgicas, camas, etc.)', true],
  // Saneantes
  ['3402',   'ANVISA', 'Agentes orgânicos de superfície (detergentes, desinfetantes)', false],
  ['3808',   'ANVISA', 'Inseticidas, raticidas, fungicidas (uso domissanitário)', true],
  // Reagentes/diagnóstico
  ['3822',   'ANVISA', 'Reagentes de diagnóstico/laboratório', true],

  // ============== MAPA — Agropecuária / Alimentos ==============
  ['01',     'MAPA',   'Animais vivos - certificação sanitária', true],
  ['02',     'MAPA',   'Carnes e miudezas comestíveis', true],
  ['03',     'MAPA',   'Peixes, crustáceos, moluscos', true],
  ['04',     'MAPA',   'Laticínios, ovos, mel - registro de estabelecimento', true],
  ['05',     'MAPA',   'Outros produtos de origem animal', true],
  ['06',     'MAPA',   'Plantas vivas, flores - certificado fitossanitário', true],
  ['07',     'MAPA',   'Produtos hortícolas (legumes)', true],
  ['08',     'MAPA',   'Frutas e cascas', true],
  ['09',     'MAPA',   'Café, chá, mate, especiarias', true],
  ['10',     'MAPA',   'Cereais', true],
  ['11',     'MAPA',   'Produtos da indústria de moagem (farinhas, amidos)', true],
  ['12',     'MAPA',   'Sementes, frutos oleaginosos, plantas industriais', true],
  ['13',     'MAPA',   'Gomas, resinas e outros sucos vegetais', false],
  ['1404',   'MAPA',   'Outros produtos de origem vegetal', false],
  ['15',     'MAPA',   'Gorduras e óleos animais ou vegetais', true],
  ['16',     'MAPA',   'Preparações de carne, peixe, crustáceos', true],
  ['17',     'MAPA',   'Açúcares e produtos de confeitaria', false],
  ['18',     'MAPA',   'Cacau e suas preparações', false],
  ['19',     'MAPA',   'Preparações à base de cereais, farinhas, amidos', false],
  ['20',     'MAPA',   'Preparações de produtos hortícolas, frutas (conservas)', false],
  ['21',     'MAPA',   'Preparações alimentícias diversas', false],
  ['22',     'MAPA',   'Bebidas, líquidos alcoólicos e vinagres', true],
  ['23',     'MAPA',   'Resíduos da indústria alimentar; alimentos para animais', true],
  ['24',     'MAPA',   'Tabaco e seus sucedâneos', true],
  // Defensivos agrícolas
  ['3808',   'MAPA',   'Inseticidas, fungicidas (uso agrícola)', true],

  // ============== ANVISA secundário em alimentos / bebidas ==============
  ['16',     'ANVISA', 'Produtos preparados de carne/peixe - registro', false],
  ['19',     'ANVISA', 'Alimentos infantis, dietéticos', false],
  ['21',     'ANVISA', 'Suplementos alimentares, alimentos especiais', false],
  ['22',     'ANVISA', 'Bebidas - aspectos sanitários', true],

  // ============== ANP — Combustíveis ==============
  ['27',     'ANP',    'Combustíveis minerais, óleos minerais e derivados', true],
  ['2710',   'ANP',    'Óleos de petróleo (gasolina, diesel, querosene, lubrificantes)', true],
  ['2711',   'ANP',    'Gás natural e GLP', true],
  ['2712',   'ANP',    'Vaselina, ceras de petróleo', false],
  ['2713',   'ANP',    'Coque de petróleo, betume', false],
  ['2714',   'ANP',    'Betumes e asfaltos naturais', false],
  ['3403',   'ANP',    'Preparações lubrificantes', false],

  // ============== IBAMA — Meio ambiente / Químicos controlados ==============
  ['28',     'IBAMA',  'Produtos químicos inorgânicos - alguns controlados', false],
  ['29',     'IBAMA',  'Produtos químicos orgânicos - controle ambiental', false],
  ['2903',   'IBAMA',  'Substâncias que destroem a camada de ozônio (Protocolo Montreal)', true],
  ['38',     'IBAMA',  'Produtos químicos diversos', false],
  ['3808',   'IBAMA',  'Defensivos agrícolas - registro ambiental', true],
  ['3824',   'IBAMA',  'Misturas químicas controladas', false],
  ['44',     'IBAMA',  'Madeira - controle de origem (especialmente tropical)', false],
  ['4403',   'IBAMA',  'Madeira em bruto - DOF/CITES', true],
  ['41',     'IBAMA',  'Couros e peles - quando origem silvestre (CITES)', false],
  ['43',     'IBAMA',  'Peleteria - controle CITES para espécies ameaçadas', false],
  ['9601',   'IBAMA',  'Marfim, osso, casco - CITES', true],
  ['9706',   'IBAMA',  'Antiguidades com componentes de espécies controladas - CITES', false],

  // ============== Exército — Armas, Munições, Explosivos ==============
  ['93',     'EXERCITO', 'Armas e munições - autorização do Exército', true],
  ['3601',   'EXERCITO', 'Pólvoras propulsivas', true],
  ['3602',   'EXERCITO', 'Explosivos preparados', true],
  ['3603',   'EXERCITO', 'Estopins, espoletas, capsulas detonadoras', true],
  ['3604',   'EXERCITO', 'Fogos de artifício, foguetes de sinalização', true],
  ['3605',   'EXERCITO', 'Fósforos químicos com requisitos', false],
  ['9304',   'EXERCITO', 'Outras armas (gas, pressão de ar, mola)', true],
  ['9305',   'EXERCITO', 'Partes e acessórios das armas', true],
  ['9306',   'EXERCITO', 'Munições e projéteis', true],

  // ============== INMETRO — Certificação compulsória ==============
  ['4011',   'INMETRO', 'Pneus novos - certificação obrigatória', true],
  ['4013',   'INMETRO', 'Câmaras de ar', false],
  ['6401',   'INMETRO', 'Calçados de borracha/plástico', false],
  ['6402',   'INMETRO', 'Outros calçados', false],
  ['6403',   'INMETRO', 'Calçados de couro', false],
  ['6404',   'INMETRO', 'Calçados com sola plástico/borracha e couro', false],
  ['8413',   'INMETRO', 'Bombas para líquidos', false],
  ['8415',   'INMETRO', 'Aparelhos de ar condicionado', true],
  ['8418',   'INMETRO', 'Refrigeradores, freezers, bombas de calor - selo PROCEL', true],
  ['8421',   'INMETRO', 'Filtros, purificadores de água', true],
  ['8443',   'INMETRO', 'Impressoras', false],
  ['8450',   'INMETRO', 'Máquinas de lavar roupa', true],
  ['8451',   'INMETRO', 'Máquinas para lavanderia comercial', false],
  ['8452',   'INMETRO', 'Máquinas de costura', false],
  ['8501',   'INMETRO', 'Motores elétricos', true],
  ['8504',   'INMETRO', 'Transformadores e fontes (acima de certas potências)', false],
  ['850440', 'INMETRO', 'Conversores estáticos (UPS, fontes externas)', true],
  ['8506',   'INMETRO', 'Pilhas elétricas', true],
  ['8507',   'INMETRO', 'Acumuladores elétricos (baterias)', true],
  ['8508',   'INMETRO', 'Aspiradores de pó', false],
  ['8509',   'INMETRO', 'Eletrodomésticos com motor elétrico', false],
  ['8511',   'INMETRO', 'Velas, ignição automotiva', false],
  ['8512',   'INMETRO', 'Faróis e equipamentos elétricos automotivos', true],
  ['8513',   'INMETRO', 'Lanternas elétricas portáteis', false],
  ['8516',   'INMETRO', 'Aparelhos elétricos de aquecimento (chuveiros, aquecedores)', true],
  ['8528',   'INMETRO', 'TVs - eficiência energética + segurança elétrica', true],
  ['8536',   'INMETRO', 'Interruptores, tomadas, plugues', true],
  ['8537',   'INMETRO', 'Quadros elétricos', false],
  ['8538',   'INMETRO', 'Partes para 8535-8537', false],
  ['8539',   'INMETRO', 'Lâmpadas elétricas (incandescentes, LED, fluorescentes)', true],
  ['8544',   'INMETRO', 'Fios, cabos isolados', true],
  ['9028',   'INMETRO', 'Medidores (água, gás, eletricidade)', true],
  ['9405',   'INMETRO', 'Luminárias e suas partes', true],
  ['9503',   'INMETRO', 'Brinquedos - certificação compulsória', true],
  ['9504',   'INMETRO', 'Jogos eletrônicos', false],
  ['9506',   'INMETRO', 'Artigos esportivos (capacetes, protetores)', false],

  // Têxteis - INMETRO etiquetagem
  ['50',     'INMETRO', 'Têxteis de seda - etiquetagem', false],
  ['51',     'INMETRO', 'Têxteis de lã - etiquetagem', false],
  ['52',     'INMETRO', 'Algodão - etiquetagem', false],
  ['53',     'INMETRO', 'Outras fibras vegetais', false],
  ['54',     'INMETRO', 'Filamentos sintéticos/artificiais - etiquetagem', false],
  ['55',     'INMETRO', 'Fibras sintéticas/artificiais descontínuas', false],
  ['56',     'INMETRO', 'Pastas (ouates), feltros, cordoalha', false],
  ['58',     'INMETRO', 'Tecidos especiais', false],
  ['60',     'INMETRO', 'Tecidos de malha', false],
  ['61',     'INMETRO', 'Vestuário de malha - etiquetagem compulsória', true],
  ['62',     'INMETRO', 'Vestuário, exceto de malha - etiquetagem', true],
  ['63',     'INMETRO', 'Outros artefatos têxteis confeccionados', false],

  // ============== DENATRAN/SENATRAN — Veículos ==============
  ['8702',   'INMETRO', 'Veículos de transporte coletivo - certificação', true],
  ['8703',   'INMETRO', 'Automóveis de passageiros - certificação', true],
  ['8704',   'INMETRO', 'Veículos de carga (caminhões)', true],
  ['8705',   'INMETRO', 'Veículos automóveis para usos especiais', false],
  ['8711',   'INMETRO', 'Motocicletas', true],
  ['8716',   'INMETRO', 'Reboques e semirreboques', false],

  // ============== ANAC — Aeronáutico ==============
  ['88',     'ANAC',   'Aeronaves e suas partes', true],
  ['8801',   'ANAC',   'Balões, dirigíveis, planadores', true],
  ['8802',   'ANAC',   'Outros veículos aéreos (aviões, helicópteros)', true],
  ['8803',   'ANAC',   'Partes dos veículos aéreos', true],
  ['8804',   'ANAC',   'Paraquedas', true],
  ['8805',   'ANAC',   'Aparelhos para lançamento de veículos aéreos', true],

  // ============== Marinha do Brasil / DPC — Embarcações ==============
  ['89',     'MARINHA', 'Embarcações - registro junto à Marinha', true],
  ['8901',   'MARINHA', 'Transatlânticos, navios de cruzeiro', true],
  ['8902',   'MARINHA', 'Embarcações de pesca, fabriqueiros', true],
  ['8903',   'MARINHA', 'Iates e embarcações de recreio', true],
  ['8904',   'MARINHA', 'Rebocadores e empurradores', true],
  ['8905',   'MARINHA', 'Barcos-faróis, dragas, plataformas', true],
  ['8906',   'MARINHA', 'Outras embarcações (incluindo navios de guerra)', true],
  ['8907',   'MARINHA', 'Outras estruturas flutuantes', true],

  // ============== Polícia Federal — Precursores químicos ==============
  ['1211',   'POLICIA_FEDERAL', 'Plantas com substâncias de uso controlado', false],
  ['2806',   'POLICIA_FEDERAL', 'Cloreto de hidrogênio (precursor)', true],
  ['2807',   'POLICIA_FEDERAL', 'Ácido sulfúrico (precursor)', true],
  ['2902',   'POLICIA_FEDERAL', 'Hidrocarbonetos cíclicos (tolueno - precursor)', true],
  ['2914',   'POLICIA_FEDERAL', 'Cetonas (acetona, MEK - precursores)', true],
  ['2915',   'POLICIA_FEDERAL', 'Ácidos orgânicos (anidrido acético - precursor)', true],
  ['2922',   'POLICIA_FEDERAL', 'Aminoácidos (efedrina - precursor)', true],
  ['2924',   'POLICIA_FEDERAL', 'Compostos de função carboxiamida (acetaminofeno)', false],

  // ============== CNEN — Energia nuclear ==============
  ['2612',   'CNEN',   'Minérios de urânio, tório', true],
  ['2844',   'CNEN',   'Elementos químicos radioativos e isótopos', true],
  ['2845',   'CNEN',   'Isótopos não radioativos (deutério, trítio)', true],
  ['8401',   'CNEN',   'Reatores nucleares', true],

  // ============== IPHAN — Patrimônio cultural ==============
  ['97',     'IPHAN',  'Obras de arte, peças de coleção, antiguidades', true],
  ['9701',   'IPHAN',  'Quadros, pinturas e desenhos', true],
  ['9702',   'IPHAN',  'Gravuras, estampas e litografias originais', true],
  ['9703',   'IPHAN',  'Obras originais de estatuária e escultura', true],
  ['9705',   'IPHAN',  'Coleções e espécimes (zoologia, botânica, mineralogia)', true],
  ['9706',   'IPHAN',  'Antiguidades com mais de 100 anos', true],

  // ============== MAPI / DECEX — Outros controles ==============
  // (DECEX é genérico para licença de importação não automática)
  ['8702',   'DECEX',  'LI não automática para usados', false],

  // ============== MCTI — Bens de informática (Lei 8.248) ==============
  ['8471',   'MCTI',   'Equipamentos de processamento de dados (Lei de Informática - opcional)', false],
  ['8473',   'MCTI',   'Partes/acessórios de máquinas das pos. 8470-8472', false],

  // ============== MTUR / Ministério do Esporte (alguns esportivos) ==============
  // (raramente aparece)

  // ============== Decex/Secex — Licença de importação (LI) ==============
  // (não é "anuente" stricto sensu — é processo administrativo geral)
];

const out = [['ncm', 'anuente', 'descricao', 'obrigatorio']];
for (const [ncm, anuente, descricao, obrigatorio] of REGRAS) {
  out.push([
    String(ncm).replace(/\D/g, ''),
    anuente,
    descricao,
    obrigatorio !== false ? 'true' : 'false',
  ]);
}

const csv = out.map(row =>
  row.map(c => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')
).join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv);

// Stats
const porAnuente = {};
for (const r of REGRAS) {
  porAnuente[r[1]] = (porAnuente[r[1]] || 0) + 1;
}

console.log(`✓ CSV gerado: ${outputPath}`);
console.log(`  Total regras: ${REGRAS.length}`);
console.log(`  Tamanho: ${(csv.length/1024).toFixed(1)} KB`);
console.log(`  Por anuente:`);
for (const [k, v] of Object.entries(porAnuente).sort((a,b) => b[1]-a[1])) {
  console.log(`    ${k.padEnd(20)} ${v}`);
}
