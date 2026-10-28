/**
 * Matriz de resultados do cliente (GC-AJ-018), transcrita de
 * `Matrizes de montagem de resultado.xlsx` e do guia que a acompanha
 * (reunião de 26/10/2026).
 *
 * O resumo do laudo de Performance é montado só com estes textos — a IA foi
 * descartada em 20/10 ("nada de IA, só a matriz"). São três peças:
 *
 * - **9 perfis principais**, pela combinação das faixas de Força & Potência e de
 *   Resistência & Capacidade Aeróbica;
 * - **12 moduladores**, um texto por faixa em cada uma das outras quatro
 *   categorias;
 * - **as referências** citadas, listadas no fim pelo número.
 *
 * O texto é do cliente: qualquer mudança de redação aqui precisa vir dele, e
 * sobe a `MATRIX_VERSION` para os laudos antigos continuarem rastreáveis.
 */

/** Nível da matriz, que é a faixa do escore com o nome que o guia usa. */
export type MatrixLevel = 'alta' | 'intermediaria' | 'baixa';

export const MATRIX_VERSION = 'matriz-v1';

/** Categorias que definem o perfil principal. */
export const STRENGTH_SLUG = 'forca_potencia';
export const ENDURANCE_SLUG = 'resistencia_aerobica';

/** Referências usadas por todos os perfis principais. */
export const PROFILE_REFERENCES = [1, 3, 5, 7, 8, 9, 10, 11, 12, 13] as const;

/** Perfil principal: chave `forca|resistencia`. */
export const PROFILES: Readonly<Record<string, string>> = {
  'alta|alta':
    'Seus escores de Força & Potência, e de Resistência & Capacidade Aeróbica, ficaram ambos na faixa alta em comparação com a população de referência. Isso indica que, entre os marcadores analisados, há maior presença de variantes associadas, segundo estudos científicos, a um melhor desempenho nesses dois tipos de esforço. O perfil é versátil, ou seja, não aponta uma vocação específica e é compatível tanto com modalidades de força e velocidade quanto com as de longa duração.',
  'alta|intermediaria':
    'Seu escore de Força & Potência ficou na faixa alta, e o de Resistência & Capacidade Aeróbica na faixa intermediária. Entre os marcadores analisados, há maior presença de variantes associadas à força, à potência e à velocidade, sem desvantagem significativa no domínio aeróbico. É um perfil com leve inclinação para esforços curtos e intensos, que não restringe atividades de longa duração — a capacidade aeróbica melhora de forma expressiva com treinamento na maioria das pessoas.',
  'alta|baixa':
    'Seu escore de Força & Potência ficou na faixa alta, enquanto o de Resistência & Capacidade Aeróbica ficou na faixa baixa. Esse é o contraste mais marcante do painel em relação aos esforços curtos e intensos, já que os marcadores analisados favorecem mais a força, a potência e a velocidade do que o desempenho de longa duração. O escore aeróbico baixo não indica incapacidade para exercícios prolongados nem limita a melhora com o treino aeróbico, apenas indica que, entre as variantes avaliadas, poucas estão associadas a uma vantagem nesse domínio.',
  'intermediaria|alta':
    'Seu escore de Resistência & Capacidade Aeróbica ficou na faixa alta, e o de Força & Potência na faixa intermediária. Entre os marcadores analisados, há maior presença de variantes associadas à capacidade aeróbica e ao desempenho em esforços prolongados, sem desvantagem marcada no domínio de força. É um perfil com leve inclinação para atividades de longa duração, sem restringir o treino de força nem as modalidades intermitentes.',
  'intermediaria|intermediaria':
    'Seus escores de Força & Potência e de Resistência & Capacidade Aeróbica ficaram ambos na faixa intermediária, onde se situa a maior parte da população de referência. Os marcadores analisados não indicam predomínio de um tipo de esforço sobre o outro. Na prática, a genética avaliada não sugere direcionamento: modalidade, volume e intensidade devem ser definidos por objetivos, avaliação física e resposta ao treino.',
  'intermediaria|baixa':
    'Seu escore de Força & Potência ficou na faixa intermediária, e o de Resistência & Capacidade Aeróbica, na faixa baixa. Ao comparar os dois domínios, os marcadores analisados apontam levemente para esforços de Força & Potência, mas sem destaque expressivo. O baixo escore de Resistência & Capacidade Aeróbica se refere apenas às variantes avaliadas e não indica limitação para atividades prolongadas, que podem melhorar com treinamento adequado.',
  'baixa|alta':
    'Seu escore de Resistência & Capacidade Aeróbica ficou na faixa alta, enquanto o de Força & Potência ficou na faixa baixa. É o contraste mais evidente do painel em relação a esforços prolongados: os marcadores analisados favorecem mais a capacidade aeróbica do que a força e a velocidade. O baixo escore de força não indica pouca força muscular real nem limita os ganhos com o treino resistido, que dependem principalmente de estímulo, progressão e nutrição adequados.',
  'baixa|intermediaria':
    'Seu escore de Resistência & Capacidade Aeróbica ficou na faixa intermediária, e o de Força & Potência na faixa baixa. Ao comparar os dois domínios, os marcadores analisados tendem levemente a favorecer os esforços aeróbicos, embora sem destaque significativo. O escore de força baixo refere-se apenas às variantes avaliadas e não indica limitação para ganhar força ou massa muscular com o treinamento.',
  'baixa|baixa':
    'Seus escores de Força & Potência e de Resistência & Capacidade Aeróbica ficaram ambos na faixa baixa em relação à população de referência. Isso indica apenas que, entre os marcadores analisados, são menos frequentes as variantes associadas a vantagens nesses domínios. O resultado não significa menor capacidade física, falta de potencial esportivo ou uma resposta inferior ao treinamento. Estudos mostram que os perfis genéticos de atletas de elite e de não atletas se sobrepõem amplamente e que o desempenho é construído principalmente por meio de treino, técnica, nutrição e recuperação.',
};

export interface Modulator {
  readonly slug: string;
  readonly references: readonly number[];
  readonly texts: Readonly<Record<MatrixLevel, string>>;
}

/** Os quatro moduladores, na ordem em que entram no texto. */
export const MODULATORS: readonly Modulator[] = [
  {
    slug: 'recuperacao_inflamacao',
    references: [14, 15],
    texts: {
      alta: 'Os marcadores de Recuperação & Resposta Inflamatória ficaram na faixa alta, com maior presença de variantes que, segundo estudos, estão associadas a uma resposta inflamatória menor ou a uma menor elevação de marcadores de dano muscular (como a creatina quinase) após exercícios intensos. Esses efeitos são pequenos e nem sempre se repetem entre os estudos; por isso, o resultado não permite estimar o tempo de recuperação individual. Sono, nutrição, carga de treino e o acompanhamento da dor, da fadiga e do desempenho continuam sendo as melhores referências.',
      intermediaria:
        'Os marcadores de Recuperação & Resposta Inflamatória ficaram na faixa intermediária, sem predomínio de variantes associadas a resposta inflamatória mais ou menos acentuada após o exercício. A recuperação deve ser ajustada por indicadores práticos: percepção de esforço e fadiga, qualidade do sono, dor muscular e desempenho nas sessões.',
      baixa:
        'Os marcadores de Recuperação & Resposta Inflamatória ficaram na faixa baixa, com maior presença de variantes que alguns estudos associam a respostas inflamatórias mais intensas ou a maiores elevações dos marcadores de dano muscular após exercícios exigentes. Essas associações são modestas e inconsistentes, portanto, o resultado não indica inflamação nem prevê uma recuperação lenta. Ainda assim, pode servir como lembrete para acompanhar a resposta a sessões intensas ou com ênfase excêntrica e para respeitar a progressão da carga.',
    },
  },
  {
    slug: 'risco_lesao',
    references: [16, 17, 26],
    texts: {
      alta: 'Os marcadores de Risco de Lesão & Estrutura, relacionados à estrutura e ao remodelamento de tendões, ligamentos e outros tecidos conjuntivos, ficaram na faixa alta. Isso indica uma menor presença de variantes que alguns estudos associaram a lesões nesses tecidos. A evidência, porém, é limitada e os estudos genômicos abrangentes não confirmaram a maioria dessas associações. Portanto, o resultado não significa proteção contra lesões e a progressão de carga, o fortalecimento e a técnica continuam sendo essenciais.',
      intermediaria:
        'Os marcadores de Risco de Lesão & Estrutura ficaram na faixa intermediária. O risco de lesões musculoesqueléticas depende principalmente de fatores conhecidos e, em grande parte, modificáveis — como histórico de lesões, carga e progressão do treino, força, mobilidade, técnica e recuperação —, que devem orientar as medidas de prevenção.',
      baixa:
        'Os marcadores de Risco de Lesão & Estrutura situaram-se na faixa baixa, com maior presença de variantes que alguns estudos associaram a lesões em tendões e ligamentos. Essas associações apresentam efeitos reduzidos e não foram confirmadas de forma consistente, portanto, os resultados não permitem prever a ocorrência de lesões. Eles podem reforçar boas práticas recomendadas a qualquer atleta, como a progressão gradual das cargas, o fortalecimento, a atenção às queixas iniciais nos tendões e nas articulações e a consideração do histórico clínico.',
    },
  },
  {
    slug: 'metabolismo_composicao',
    references: [18, 19, 20],
    texts: {
      alta: 'Os marcadores de Metabolismo & Composição Corporal ficaram na faixa alta, com maior presença de variantes associadas, em estudos populacionais, a menor tendência ao acúmulo de gordura corporal. Cada variante apresenta um efeito pequeno, que é atenuado em indivíduos fisicamente ativos. Esse resultado não permite prever o peso, o percentual de gordura ou a resposta a uma dieta específica. A composição corporal deve ser mensurada diretamente e monitorada ao longo do tempo.',
      intermediaria:
        'Os marcadores de Metabolismo & Composição Corporal ficaram na faixa intermediária, sem predomínio de variantes associadas a uma maior ou menor tendência ao acúmulo de gordura corporal. Alimentação, volume de treino, sono e avaliações periódicas da composição corporal são os fatores determinantes.',
      baixa:
        'Os marcadores de Metabolismo & Composição Corporal ficaram na faixa baixa, com maior presença de variantes que, em estudos populacionais, estão associadas a uma maior tendência ao acúmulo de gordura corporal. O efeito de cada variante é pequeno e pode ser substancialmente reduzido com a prática regular de atividade física. Esse resultado não implica maior adiposidade nem dificuldade inevitável para controlar o peso. Além disso, estudos controlados não demonstraram vantagem em escolher a dieta com base no genótipo, e o acompanhamento nutricional e as medidas diretas da composição corporal são as referências adequadas.',
    },
  },
  {
    slug: 'neuroperformance',
    references: [21, 22],
    texts: {
      alta: 'Os marcadores de Neuroperformance & Tempo de Resposta, ligados à neurotransmissão e à plasticidade neuronal, ficaram na faixa alta. Este é o domínio com evidências mais preliminares do painel: meta-análises não confirmaram efeitos consistentes dessas variantes sobre atenção, memória ou funções cognitivas. Portanto, o resultado é exploratório e não indica maior concentração, coordenação ou rapidez de reação.',
      intermediaria:
        'Os marcadores de Neuroperformance & Tempo de Resposta ficaram na faixa intermediária. Esse é um domínio exploratório, com evidências científicas ainda preliminares. Atenção, tomada de decisão e tempo de reação dependem principalmente de treinamento específico, experiência, sono e nível de fadiga.',
      baixa:
        'Os marcadores de Neuroperformance & Tempo de Resposta ficaram na faixa baixa. Esse é um domínio exploratório, e suas associações com o desempenho cognitivo e motor ainda não foram confirmadas de forma consistente. O resultado não indica prejuízo cognitivo, redução da atenção nem lentidão no tempo de reação.',
    },
  },
];

/** As 26 referências da matriz, pelo número de identificação. */
export const REFERENCES: Readonly<Record<number, string>> = {
  1: 'Webborn N, Williams A, McNamee M, et al. Direct-to-consumer genetic testing for predicting sports performance and talent identification: consensus statement. Br J Sports Med. 2015;49(23):1486-1491.',
  2: 'Vlahovich N, Fricker PA, Brown MA, Hughes D. Ethics of genetic testing and research in sport: a position statement from the Australian Institute of Sport. Br J Sports Med. 2017;51(1):5-11.',
  3: 'Pickering C, Kiely J, Grgic J, Lucia A, Del Coso J. Can genetic testing identify talent for sport? Genes (Basel). 2019;10(12):972.',
  4: 'Varillas-Delgado D, Del Coso J, Gutiérrez-Hellín J, et al. Genetics and sports performance: the present and future in the identification of talent for sports based on DNA testing. Eur J Appl Physiol. 2022;122(8):1811-1830.',
  5: 'Semenova EA, Hall ECR, Ahmetov II. Genes and athletic performance: the 2023 update. Genes (Basel). 2023;14(6):1235.',
  6: 'Guilherme JPLF, Tritto ACC, North KN, Lancha Junior AH, Artioli GG. Genetics and sport performance: current challenges and directions to the future. Rev Bras Educ Fís Esporte. 2014;28(1):177-193.',
  7: 'Williams AG, Folland JP. Similarity of polygenic profiles limits the potential for elite human physical performance. J Physiol. 2008;586(1):113-121.',
  8: 'Ruiz JR, Gómez-Gallego F, Santiago C, et al. Is there an optimum endurance polygenic profile? J Physiol. 2009;587(Pt 7):1527-1534.',
  9: 'Bouchard C, An P, Rice T, et al. Familial aggregation of VO2max response to exercise training: results from the HERITAGE Family Study. J Appl Physiol. 1999;87(3):1003-1008.',
  10: 'Bouchard C, Sarzynski MA, Rice TK, et al. Genomic predictors of the maximal O2 uptake response to standardized exercise training programs. J Appl Physiol. 2011;110(5):1160-1170.',
  11: 'Miyamoto-Mikami E, Zempo H, Fuku N, et al. Heritability estimates of endurance-related phenotypes: a systematic review and meta-analysis. Scand J Med Sci Sports. 2018;28(3):834-845.',
  12: 'Yang N, MacArthur DG, Gulbin JP, et al. ACTN3 genotype is associated with human elite athletic performance. Am J Hum Genet. 2003;73(3):627-631.',
  13: 'Pickering C, Kiely J. ACTN3: more than just a gene for speed. Front Physiol. 2017;8:1080.',
  14: 'Baumert P, Lake MJ, Stewart CE, Drust B, Erskine RM. Genetic variation and exercise-induced muscle damage: implications for athletic performance, injury and ageing. Eur J Appl Physiol. 2016;116(9):1595-1625.',
  15: 'Del Coso J, Valero M, Salinero JJ, et al. ACTN3 genotype influences exercise-induced muscle damage during a marathon competition. Eur J Appl Physiol. 2017;117(3):409-416.',
  16: 'Collins M, Raleigh SM. Genetic risk factors for musculoskeletal soft tissue injuries. Med Sport Sci. 2009;54:136-149.',
  17: 'Kim SK, Roos TR, Roos AK, et al. Genome-wide association screens for Achilles tendon and ACL tears and tendinopathy. PLoS One. 2017;12(3):e0170422.',
  18: 'Loos RJF, Yeo GSH. The genetics of obesity: from discovery to biology. Nat Rev Genet. 2022;23(2):120-133.',
  19: 'Kilpeläinen TO, Qi L, Brage S, et al. Physical activity attenuates the influence of FTO variants on obesity risk: a meta-analysis of 218,166 adults and 45,247 children. PLoS Med. 2011;8(11):e1001116.',
  20: 'Gardner CD, Trepanowski JF, Del Gobbo LC, et al. Effect of low-fat vs low-carbohydrate diet on 12-month weight loss in overweight adults and the association with genotype pattern or insulin secretion: the DIETFITS randomized clinical trial. JAMA. 2018;319(7):667-679.',
  21: 'Barnett JH, Scoriels L, Munafò MR. Meta-analysis of the cognitive effects of the catechol-O-methyltransferase gene Val158/108Met polymorphism. Biol Psychiatry. 2008;64(2):137-144.',
  22: 'Mandelman SD, Grigorenko EL. BDNF Val66Met and cognition: all, none, or some? A meta-analysis of the genetic association. Genes Brain Behav. 2012;11(2):127-136.',
  23: 'Wand H, Lambert SA, Tamburro C, et al. Improving reporting standards for polygenic scores in risk prediction studies. Nature. 2021;591(7849):211-219.',
  24: 'Martin AR, Kanai M, Kamatani Y, et al. Clinical use of current polygenic risk scores may exacerbate health disparities. Nat Genet. 2019;51(4):584-591.',
  25: 'Brasil. Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais (LGPD), art. 5º, II, e art. 11.',
  26: 'September AV, Schwellnus MP, Collins M. Tendon and ligament injuries: the genetic component. Br J Sports Med. 2007;41(4):241-246.',
};
