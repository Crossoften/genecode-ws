/**
 * De quem a API aceita o X-Forwarded-For (card #749, PDF 05).
 *
 * Só do próprio servidor: é o Apache da produção, na mesma máquina. Sem isto,
 * atrás dele toda requisição vinha de 127.0.0.1 e o limite de tentativas do
 * login era um só para todos os usuários. Quem fala direto com a API (o
 * homolog, com TLS no processo) não consegue forjar o endereço.
 */
export const TRUST_PROXY = 'loopback';
