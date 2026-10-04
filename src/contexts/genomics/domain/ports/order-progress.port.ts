/**
 * Porta: o que o pedido precisa saber sobre o laudo do titular.
 *
 * ## A história desta porta, que teve duas decisões opostas
 *
 * Nasceu de um defeito achado em 01/10/2026: a importação do CSV publicava o
 * laudo mas **não mexia no pedido** — e a área do titular libera o laudo pelo
 * estado do *pedido*. O resultado era laudo publicado, laboratório vendo tudo
 * no Histórico, e o titular com o botão "Ver laudo interativo" cinza, sem
 * explicação. A decisão do André naquele dia foi fechar assim: publicar o laudo
 * **é** o evento que libera, sem conferência humana no meio.
 *
 * Em 02/10 o Camara decidiu o contrário, e é a decisão que vale:
 *
 * > *"A publicação do laudo deve encerrar o pedido automaticamente? Deve haver
 * > uma conferência humana responsável por disparar o aviso ao cliente."*
 *
 * O desenho de agora honra a segunda sem reabrir o buraco da primeira. O laudo
 * nasce **DRAFT**: o titular não o vê em lugar nenhum, então não existe o
 * estado "publicado e invisível" que gerou o defeito. O pedido avança só até
 * **Em análise**, que é verdade. Na liberação, as duas coisas viram juntas —
 * laudo PUBLISHED e pedido em Laudo disponível, com o aviso ao cliente.
 */
export const ORDER_PROGRESS = Symbol('ORDER_PROGRESS');

export interface OrderProgress {
  /**
   * O laboratório calculou o laudo, que ainda aguarda conferência.
   *
   * Leva o pedido até **Em análise** e **não avisa o cliente**: não há o que
   * avisar enquanto ninguém conferiu.
   *
   * Implementação não pode lançar: o laudo já está gravado quando isto roda, e
   * derrubar a linha por causa do acompanhamento faria o laboratório reenviar
   * um arquivo que já entrou.
   *
   * @param subjectId - Titular do laudo recém-calculado.
   */
  reportComputed(subjectId: string): Promise<void>;

  /**
   * Alguém conferiu e liberou o laudo.
   *
   * Leva o pedido a **Laudo disponível** e dispara o aviso ao cliente. Aqui,
   * sim, pode lançar: se o pedido não avançar, o titular ficaria com laudo
   * publicado e botão cinza — exatamente o defeito de 01/10 —, e é melhor a
   * liberação falhar inteira do que pela metade.
   *
   * @param subjectId - Titular do laudo liberado.
   * @param actor - Quem liberou, para a trilha de auditoria.
   */
  reportReleased(subjectId: string, actor: string): Promise<void>;
}
