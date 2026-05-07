import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';

// Calcula comissões mensais por parceiro (= Cliente.escritorio).
// Mantém a regra do sistema antigo: período entre (dia_fechamento+1) do mês
// anterior e dia_fechamento do mês corrente, sobre os créditos do cliente.
export async function listComissoes(user, { parceiro, mes, ano } = {}) {
  const clientes = await prisma.cliente.findMany({
    where: { AND: [clienteScope(user), { percentualComissao: { gt: 0 } }] },
    select: {
      id: true, nome: true, escritorio: true,
      percentualComissao: true, diaFechamento: true,
    },
  });
  if (clientes.length === 0) return [];

  const ids = clientes.map(c => c.id);
  const movs = await prisma.movimentacao.findMany({
    where: {
      clienteId: { in: ids },
      tipoMovimento: 'Créditos Reconhecidos e Cedidos',
    },
    select: { clienteId: true, dataNf: true, valorAjustado: true },
    orderBy: { dataNf: 'asc' },
  });
  if (movs.length === 0) return [];

  const movDates = movs.map(m => m.dataNf).filter(Boolean).sort((a,b)=>a-b);
  const minDate = movDates[0];
  const maxDate = movDates[movDates.length - 1];
  if (!minDate || !maxDate) return [];

  const acc = {};

  for (const cliente of clientes) {
    const dia = cliente.diaFechamento || 1;
    const pct = cliente.percentualComissao || 0;
    if (pct <= 0) continue;
    const partner = cliente.escritorio || 'Sem Escritório';
    const ms = movs.filter(m => m.clienteId === cliente.id);
    if (ms.length === 0) continue;

    let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);

    while (cur <= end) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const ini = new Date(y, m - 1, dia + 1);
      const fim = new Date(y, m, dia, 23, 59, 59, 999);

      const totalCred = ms.reduce((s, x) => {
        if (!x.dataNf) return s;
        return (x.dataNf >= ini && x.dataNf <= fim) ? s + (x.valorAjustado || 0) : s;
      }, 0);

      if (totalCred > 0) {
        const valorComissao = totalCred * (pct / 100);
        const mesAno = `${String(m + 1).padStart(2, '0')}/${y}`;
        if (!parceiro || partner === parceiro) {
          const key = `${partner}|${mesAno}`;
          if (!acc[key]) acc[key] = {
            parceiro: partner, mes_ano: mesAno, total_comissao: 0, detalhes: [],
          };
          acc[key].total_comissao += valorComissao;
          acc[key].detalhes.push({
            cliente_id: cliente.id, cliente_nome: cliente.nome,
            total_creditos: totalCred, percentual: pct, valor_comissao: valorComissao,
            periodo_inicio: ini.toISOString().slice(0,10),
            periodo_fim:    fim.toISOString().slice(0,10),
          });
        }
      }
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  let result = Object.values(acc).sort((a, b) => {
    const [mA, yA] = a.mes_ano.split('/');
    const [mB, yB] = b.mes_ano.split('/');
    return (yB + mB).localeCompare(yA + mA) || a.parceiro.localeCompare(b.parceiro);
  });

  if (mes || ano) {
    result = result.filter(r => {
      const [m, y] = r.mes_ano.split('/');
      if (mes && ano) return m === mes && y === ano;
      if (mes) return m === mes;
      if (ano) return y === ano;
      return true;
    });
  }
  return result;
}
