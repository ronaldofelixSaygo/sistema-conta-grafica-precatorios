import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';

// Saldos por cliente — agrega Créditos / Débitos de Liquidações / Transferências
// e classifica situação (Normal / Alerta / Urgente).
export async function listSaldos(user) {
  const clientes = await prisma.cliente.findMany({
    where: clienteScope(user),
    orderBy: { nome: 'asc' },
    select: {
      id: true, nome: true, escritorio: true, clienteCertificado: true,
      movimentacoes: {
        select: { tipoMovimento: true, valorAjustado: true },
      },
    },
  });

  return clientes.map(c => {
    let creditos = 0, debitos = 0, transferencias = 0, qtd = 0;
    for (const m of c.movimentacoes) {
      switch (m.tipoMovimento) {
        case 'Créditos Reconhecidos e Cedidos':
          creditos += m.valorAjustado; break;
        case 'Débitos de Liquidações':
          debitos += m.valorAjustado; qtd += 1; break;
        case 'Débitos de Transferências':
          transferencias += m.valorAjustado; break;
      }
    }
    const saldo = creditos + debitos + transferencias;
    const media_operacao = qtd > 0 ? Math.abs(debitos) / qtd : 0;
    let situacao = 'Normal';
    if (saldo < 0) situacao = 'Urgente - Comprar Saldo';
    else if (media_operacao > 0 && saldo < media_operacao * 2) situacao = 'Alerta - Comprar saldo';

    return {
      id: c.id, nome: c.nome, escritorio: c.escritorio,
      cliente_certificado: c.clienteCertificado,
      creditos, debitos, transferencias,
      qtd_operacoes: qtd, saldo, media_operacao, situacao,
    };
  });
}
