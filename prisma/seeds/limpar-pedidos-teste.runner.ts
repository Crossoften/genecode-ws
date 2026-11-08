import { PrismaClient } from '@prisma/client';

/**
 * Apaga os pedidos que nunca foram pagos (GC-N05-18): `npm run limpar:pedidos-teste`.
 *
 * Pedido da reunião de 05/11: "já tenho umas 300 compras não realizadas… na
 * hora que você falar 'vamos lançar', a gente zera". **Só roda com a
 * autorização explícita do cliente para o lançamento.** Sem `--executar`, só
 * conta e lista o que apagaria — é o modo padrão, de propósito.
 *
 * O que sai: pedidos em `PENDING_PAYMENT` ou `CANCELLED` (os que nunca viraram
 * venda) e o que pende deles — itens, pagamentos, eventos, envios e endereço
 * vão em cascata; repasses e avisos, que guardam o id sem chave estrangeira,
 * saem aqui. Pedidos pagos, kits, laudos, contas e acessos ficam como estão:
 * as contas master/admin não são tocadas.
 *
 * Antes de executar, o DevOps faz o backup do banco (o comando está no doc).
 */
const NUNCA_PAGOS = ['PENDING_PAYMENT', 'CANCELLED'] as const;

async function main(): Promise<void> {
  const executar = process.argv.includes('--executar');
  const prisma = new PrismaClient();
  try {
    const pedidos = await prisma.order.findMany({
      where: { status: { in: [...NUNCA_PAGOS] } },
      select: { id: true, number: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const ids = pedidos.map((pedido) => pedido.id);

    const [repasses, kits] = await Promise.all([
      prisma.payout.count({ where: { orderId: { in: ids } } }),
      prisma.kit.count({ where: { orderId: { in: ids } } }),
    ]);

    console.log(`Pedidos nunca pagos: ${pedidos.length}`);
    for (const status of NUNCA_PAGOS) {
      console.log(`  ${status}: ${pedidos.filter((pedido) => pedido.status === status).length}`);
    }
    console.log(`Repasses ligados a eles: ${repasses} · kits ligados a eles: ${kits}`);
    if (pedidos.length > 0) {
      console.log(`Do ${pedidos[0]!.number} ao ${pedidos[pedidos.length - 1]!.number}.`);
    }

    if (kits > 0) {
      // Kit amarrado a pedido não pago é estranho o bastante para alguém olhar
      // antes: não se apaga laudo de ninguém por engano.
      console.log('Há kits ligados a pedidos não pagos. Nada foi apagado; confira antes.');
      process.exitCode = 2;
      return;
    }

    if (!executar) {
      console.log('Modo simulação: nada foi apagado. Para apagar, rode de novo com --executar.');
      return;
    }

    const [, avisos, apagados] = await prisma.$transaction([
      prisma.payout.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.notificationLog.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.order.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`Apagados: ${apagados.count} pedidos e ${avisos.count} registros de aviso.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error('Limpeza falhou:', erro);
  process.exitCode = 1;
});
