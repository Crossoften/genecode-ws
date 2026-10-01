/**
 * Porta: o que o pedido precisa saber quando um laudo é publicado.
 *
 * Existe por um defeito achado em 01/10/2026, ao montar as 50 contas de teste do
 * laboratório. A importação do CSV publicava o laudo, mas **não mexia no
 * pedido** — e a área do titular libera o laudo pelo estado do *pedido*
 * (`exames.page.ts`, `statusAtual() !== 'REPORT_READY'` devolve nulo). O
 * resultado: laudo publicado, laboratório vendo tudo no Histórico, e o titular
 * com o botão "Ver laudo interativo" cinza, sem explicação. Era a pendência 19b,
 * e a decisão do André em 01/10 foi fechá-la assim: publicar o laudo **é** o
 * evento que deixa o laudo disponível, sem conferência humana no meio.
 *
 * É uma porta, e não uma chamada direta ao Prisma dentro do caso de uso, porque
 * mover pedido é assunto do contexto de pedidos. O contexto de genômica declara
 * o que precisa que aconteça; quem sabe como são as transições e quais avisos
 * elas devem registrar é o adaptador.
 */
export const ORDER_PROGRESS = Symbol('ORDER_PROGRESS');

export interface OrderProgress {
  /**
   * Leva à frente o pedido do titular que acabou de receber laudo.
   *
   * Implementação não pode lançar: o laudo já está publicado quando isto roda, e
   * derrubar a linha por causa do acompanhamento faria o laboratório reenviar um
   * arquivo que já entrou.
   *
   * @param subjectId - Titular do laudo recém-publicado.
   */
  reportPublished(subjectId: string): Promise<void>;
}
