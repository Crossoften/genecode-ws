import type { PrismaClient } from '@prisma/client';

/**
 * Documentos legais versionados.
 *
 * O texto aceito é **copiado** para cá, não referenciado por link. Anos depois é
 * preciso poder provar exatamente a que a pessoa consentiu — e um link aponta
 * para a versão de hoje, não para a de então.
 *
 * Publicar uma versão nova é **adicionar** uma entrada com `version`
 * incrementada e `publishedAt` mais recente, nunca editar a existente. O app
 * (`/conta/consentimentos`) devolve a versão de maior `publishedAt` por tipo.
 *
 * ### Card #526 — texto jurídico definitivo do cliente (out/2026)
 *
 * As versões 2.0 de Política de Privacidade e de Consentimento de Dado Genético
 * trazem o texto definitivo entregue pela Genoa (documento "Textos para as
 * seções de segurança, notificações e modalidades"). As minutas 1.0 ficam para
 * histórico.
 *
 * ⚠️ A CONFIRMAR com o cliente (transcrito exatamente como veio no documento):
 * - CNPJ aparece como "07.671.920/80" — formato incompleto (faltam filial e
 *   dígitos verificadores, algo como 07.671.920/0001-XX).
 * - E-mail de contato diverge entre as duas peças: o termo de segurança usa
 *   `atendimento@genecode.com.br` e a política usa `atendimento@genoabiotec.com.br`.
 *   Augusto ia confirmar qual vale.
 * - TERMS_OF_USE segue como minuta 1.0: o documento do cliente não trouxe
 *   "Termos de Uso" separados.
 */

const DATA_DE_PUBLICACAO_V1 = new Date('2026-01-01T00:00:00Z');
/** "Última atualização: abril, 2026", conforme o cabeçalho do documento do cliente. */
const DATA_DE_PUBLICACAO_V2 = new Date('2026-04-01T00:00:00Z');

/** Termo de segurança / consentimento de dado genético — texto definitivo (card #526). */
const TERMO_SEGURANCA_V2 = `# Privacidade e Segurança do Seu Exame Genético

A Genoa Biotecnologia S.A., CNPJ nº 07.671.920/80, é responsável pelo tratamento dos seus dados pessoais e genéticos e assume o compromisso de preservar sua privacidade, a confidencialidade do exame e a segurança das informações, conforme a Lei Geral de Proteção de Dados Pessoais — LGPD.

## Finalidade e confidencialidade

Seus dados serão utilizados para identificação da amostra, realização da análise, emissão e disponibilização do laudo e cumprimento das obrigações legais e regulatórias aplicáveis. O tratamento observará a base legal adequada a cada finalidade, incluindo a tutela da saúde e, quando necessário, o consentimento específico.

## Acesso e compartilhamento

O acesso será restrito a profissionais autorizados que necessitem das informações para suas funções. O laudo será disponibilizado a você, ao seu representante legal e aos profissionais de saúde autorizados, conforme o fluxo informado na contratação.

Prestadores envolvidos no processamento e no armazenamento terão acesso apenas ao necessário, sujeitos a obrigações de segurança e confidencialidade. Seus resultados não serão divulgados a familiares, academias, empregadores ou a terceiros sem autorização específica ou fundamento legal aplicável. Não comercializamos seus dados genéticos.

## Banco de dados e estudos populacionais

Os resultados da análise genética poderão integrar um banco de dados destinado ao estudo da frequência de determinadas variantes genéticas e à realização de estudos populacionais previamente planejados. Nesses estudos, os dados serão apresentados de forma agrupada, sem divulgação de nomes, documentos ou outros elementos que permitam a identificação direta dos participantes.

Quando for necessário manter um vínculo entre os resultados e o participante, será utilizado um código, e as informações de identificação serão armazenadas separadamente, com acesso restrito. A utilização dos dados para pesquisa observará a base legal aplicável, as exigências éticas pertinentes e, quando necessário, consentimento específico.

## Guarda da análise e da amostra

O laudo e os registros da análise serão conservados por 5 anos. Os arquivos genéticos e os dados da análise serão armazenados por 5 anos, e a amostra biológica e o DNA extraído serão mantidos por 7 dias após o processamento, nas condições técnicas pertinentes. Encerrados os períodos de guarda, será realizado o descarte seguro ou outra destinação legalmente permitida.

O armazenamento da amostra não constitui autorização para novos exames, pesquisa ou outras finalidades. Eventuais usos adicionais serão informados e terão fundamento legal próprio.

## Segurança e exposição das informações

Adotamos medidas técnicas e administrativas para reduzir os riscos de acesso indevido, perda, alteração ou divulgação não autorizados. Nenhum sistema é completamente imune a incidentes. Quando houver obrigação legal, os incidentes relevantes serão comunicados ao titular e à autoridade competente. Recomendamos guardar seu laudo em local protegido, preservar suas credenciais de acesso e avaliar cuidadosamente com quem deseja compartilhá-lo, pois informações genéticas podem ter implicações pessoais e familiares.

## Seus direitos e contato

Você pode solicitar informações sobre o tratamento e o acesso aos seus dados, a correção de informações cadastrais e exercer os demais direitos previstos na LGPD. A revogação de consentimento e a eliminação de dados serão avaliadas conforme a base legal e as obrigações de conservação aplicáveis.

Canal de privacidade: atendimento@genecode.com.br`;

/** Política de Privacidade e Proteção de Dados Genéticos — texto definitivo (card #526). */
const POLITICA_PRIVACIDADE_V2 = `# Política de Privacidade e Proteção de Dados Genéticos

_Última atualização: abril, 2026_

## 1. Quem somos

A Genoa Biotecnologia S.A., CNPJ nº 07.671.920/80, com sede na Avenida Angélica, 2318 (Consolação), 01228-904, São Paulo, SP, é responsável pelo tratamento dos dados pessoais utilizados na prestação de seus serviços de exames genéticos. Esta política explica como coletamos, utilizamos, armazenamos e protegemos suas informações, em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD).

## 2. Quais informações tratamos

Conforme o exame contratado, podemos tratar:

- Dados de identificação e contato, como nome, CPF, data de nascimento, telefone e e-mail.
- Informações necessárias ao atendimento, à contratação e ao pagamento.
- Informações de saúde, histórico clínico e respostas a questionários.
- Dados relacionados à amostra biológica, resultados genéticos, arquivos da análise e laudos.
- Registros de acesso aos nossos sistemas, quando aplicável.

Os dados genéticos e de saúde são dados pessoais sensíveis e recebem proteção compatível com sua natureza.

## 3. Finalidades do tratamento de dados

Utilizamos as informações necessárias para cadastrar o paciente, identificar e rastrear a amostra, realizar o exame, interpretar os resultados, emitir e disponibilizar o laudo, prestar atendimento e cumprir as obrigações legais e regulatórias.

Também podemos utilizar registros para o controle de qualidade, a segurança dos sistemas e o exercício regular de direitos, respeitando a necessidade e a finalidade de cada tratamento.

Cada atividade terá uma base legal adequada. Quando o tratamento depender de consentimento, ele será solicitado de forma específica e informada. A contratação do exame não implica autorização irrestrita para outras utilizações dos dados.

## 4. Banco de dados e estudos populacionais

Os resultados genéticos poderão integrar um banco de dados destinado ao estudo da frequência de determinadas variantes e à realização de estudos populacionais previamente planejados, desde que exista fundamento legal adequado para essa utilização.

Os estudos e suas publicações apresentarão os resultados de forma agrupada, sem exposição de nomes, documentos ou outros identificadores individuais. Também serão avaliados riscos de identificação indireta, especialmente em grupos pequenos ou envolvendo variantes raras.

Quando houver necessidade de manter um vínculo com o participante, os registros serão codificados, e as informações de identificação serão conservadas separadamente, com acesso restrito. Registros codificados continuam sujeitos às medidas de proteção de dados pessoais.

A utilização para pesquisa observará as exigências éticas aplicáveis e, quando necessário, dependerá de consentimento específico, separado da contratação do exame. Nessa hipótese, a recusa não impedirá a realização do exame contratado.

## 5. Quem pode acessar os dados

O acesso será limitado a profissionais autorizados que necessitem das informações para desempenhar suas funções.

O laudo será disponibilizado ao titular, ao seu representante legal e aos profissionais de saúde autorizados, de acordo com os procedimentos informados na contratação e com as hipóteses legais aplicáveis.

Familiares, academias, empregadores e outros terceiros não receberão os resultados sem autorização específica ou fundamento legal aplicável. Não comercializamos seus dados genéticos.

## 6. Compartilhamento com prestadores

Quando necessário, informações poderão ser compartilhadas com laboratórios de apoio, fornecedores de sistemas, serviços de armazenamento e outros prestadores envolvidos na execução do serviço, limitando-se ao necessário para cada atividade e mediante obrigações de segurança e confidencialidade.

Também poderá haver fornecimento de informações para o cumprimento de obrigação legal ou de determinação válida de autoridade competente.

## 7. Armazenamento e transferência internacional

Os dados serão armazenados na nuvem, em servidores e sistemas eletrônicos com acesso restrito a profissionais autorizados, sob a responsabilidade da Genoa Biotecnologia S.A., CNPJ nº 07.671.920/80, com suporte de armazenamento fornecido pela Microsoft Azure.

## 8. Prazos de guarda e descarte

Os períodos de conservação serão definidos conforme a finalidade, as obrigações aplicáveis e a necessidade de cada registro:

- Laudos e registros laboratoriais: 5 anos
- Arquivos genéticos e dados da análise: 5 anos
- Amostras biológicas e DNA extraído: 7 dias após processamento
- Registros destinados à pesquisa: prazo indefinido

Após esses períodos, será realizado o descarte seguro, a eliminação ou outra destinação legalmente permitida.

A conservação da amostra não autoriza, por si só, novos exames ou pesquisas. Essas atividades exigem finalidade e fundamento legal próprios.

## 9. Medidas de segurança

Adotamos medidas técnicas e administrativas para proteger seus dados pessoais e genéticos contra acesso indevido, perda, alteração e divulgação não autorizada, incluindo:

- **Controle de acesso:** credenciais individuais e permissões limitadas às informações necessárias a cada profissional, com revisão periódica e cancelamento dos acessos após o desligamento ou mudança de função.
- **Registros de operações:** registro de acessos e das principais ações realizadas nos sistemas, permitindo rastrear consultas, alterações e compartilhamentos.
- **Proteção dos arquivos:** criptografia durante a transmissão e o armazenamento dos dados, além de restrições ao download, à cópia e ao envio de informações.
- **Cópias de segurança:** realização periódica de backups protegidos, com acesso restrito e testes de recuperação.
- **Proteção dos sistemas:** atualização de software, monitoramento de segurança e uso de ferramentas de proteção contra códigos maliciosos.
- **Confidencialidade e capacitação:** compromissos de sigilo e orientação dos profissionais sobre o tratamento seguro das informações.
- **Resposta a incidentes:** procedimentos para identificar, conter e investigar incidentes, reduzir seus efeitos e realizar as comunicações exigidas.
- **Descarte seguro:** eliminação de arquivos e documentos por meio de procedimentos destinados a impedir sua recuperação indevida após o encerramento dos prazos de guarda aplicáveis.

Essas medidas são revisadas periodicamente, considerando a sensibilidade dos dados e os riscos envolvidos no seu tratamento.

Nenhum sistema é completamente imune a incidentes. Caso ocorra um incidente, serão adotadas medidas de contenção, avaliação e resposta, com comunicação ao titular e à autoridade competente quando exigida.

## 10. Seus direitos

Você pode solicitar a confirmação do tratamento de seus dados, o acesso às suas informações, correções, esclarecimentos sobre o uso e o compartilhamento, além de outros direitos previstos na LGPD. Quando o tratamento for baseado em consentimento (por exemplo, autorização ao seu instrutor ou ao profissional de educação física responsável pelo seu acompanhamento para acessar e orientar o preenchimento das suas avaliações ambientais trimestrais), você poderá revogá-lo a qualquer momento, e essa opção de revogação está disponível na aba de privacidade e compartilhamento de dados no perfil de cada usuário. Pedidos de eliminação serão avaliados considerando as obrigações de conservação e as leis aplicáveis. Para garantir a segurança das suas informações, podemos solicitar a confirmação da sua identidade antes de processar o seu pedido.

## 11. Cuidados ao compartilhar o laudo

Recomendamos manter seu laudo em local protegido, preservar suas credenciais de acesso e avaliar cuidadosamente os destinatários antes de compartilhar os resultados. Informações genéticas podem ter implicações pessoais e familiares.

## 12. Contato e atualizações

Para dúvidas ou solicitações relacionadas à privacidade, entre em contato:

Departamento de Atendimento — E-mail: atendimento@genoabiotec.com.br · Telefone: (11) 3135-6880 · Endereço: Avenida Angélica, 2318 (Consolação), 01228-904, São Paulo, SP.

Esta política poderá ser atualizada para refletir mudanças nos serviços ou nos requisitos aplicáveis. Alterações relevantes serão comunicadas pelos canais de atendimento do laboratório.`;

const DOCUMENTS = [
  // --- Minutas preliminares (histórico) -------------------------------------
  {
    type: 'TERMS_OF_USE' as const,
    version: '1.0',
    publishedAt: DATA_DE_PUBLICACAO_V1,
    content:
      '# Termos de Uso\n\n_Minuta preliminar — aguardando texto jurídico definitivo do cliente._\n\n' +
      'Ao criar uma conta na gene.code, você concorda com a coleta e o processamento da sua ' +
      'amostra biológica para a finalidade do exame contratado.',
  },
  {
    type: 'PRIVACY_POLICY' as const,
    version: '1.0',
    publishedAt: DATA_DE_PUBLICACAO_V1,
    content:
      '# Política de Privacidade\n\n_Minuta preliminar — aguardando texto jurídico definitivo._\n\n' +
      'Seus dados genéticos são dados pessoais sensíveis nos termos da LGPD (Lei 13.709/2018). ' +
      'Eles são armazenados de forma segregada da sua identidade e nunca são compartilhados sem ' +
      'o seu consentimento explícito, que pode ser revogado a qualquer momento.',
  },
  {
    type: 'GENETIC_DATA_PROCESSING' as const,
    version: '1.0',
    publishedAt: DATA_DE_PUBLICACAO_V1,
    content:
      '# Consentimento para Tratamento de Dado Genético\n\n_Minuta preliminar._\n\n' +
      'Autorizo a análise da minha amostra biológica para geração do laudo genético contratado. ' +
      'Estou ciente de que o laudo é ferramenta de autoconhecimento e não substitui avaliação ' +
      'médica, e de que posso solicitar a exclusão dos meus dados a qualquer momento.',
  },
  // --- Texto definitivo do cliente (card #526) ------------------------------
  {
    type: 'PRIVACY_POLICY' as const,
    version: '2.0',
    publishedAt: DATA_DE_PUBLICACAO_V2,
    content: POLITICA_PRIVACIDADE_V2,
  },
  {
    type: 'GENETIC_DATA_PROCESSING' as const,
    version: '2.0',
    publishedAt: DATA_DE_PUBLICACAO_V2,
    content: TERMO_SEGURANCA_V2,
  },
];

/** Semeia os documentos legais. Idempotente por tipo + versão. */
export async function seedConsentDocuments(prisma: PrismaClient): Promise<void> {
  for (const document of DOCUMENTS) {
    await prisma.consentDocument.upsert({
      where: { type_version: { type: document.type, version: document.version } },
      update: {},
      create: {
        type: document.type,
        version: document.version,
        content: document.content,
        publishedAt: document.publishedAt,
      },
    });
  }
  console.log(`✓ ${DOCUMENTS.length} documentos legais (2 definitivos + 3 minutas)`);
}
