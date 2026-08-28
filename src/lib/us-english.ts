import type { CaptionLine } from "./caption-parse.ts";
import { cleanCaptionText, wordCount } from "./lesson-pedagogy.ts";
import type { VocabItem } from "./schema.ts";

export type VocabEntry = VocabItem & {
  example: string;
  kind: "word" | "phrase";
};

const STOP = new Set(
  `a an the and or but to of in on at for from by with as is are was were be been being am do does did have has had i you he she it we they me him her us them my your his its our their this that these those not no yes so if then than too very just also can will would could should may might shall about into out up down over under again there here when what which who how why where whom whose into onto upon per via vs etc oh um uh yeah ok okay well now still even only own same such both each few more most other some any every much many one two three get got getting going went gone let lets said say says see saw seen come came coming take took taken make made making know knew known think thought want wanted need needed use used using like liked look looked looking`.split(
    /\s+/,
  ),
);

type Gloss = { meaningKo: string; meaningEn: string; ipa: string };

/** High-frequency American spoken chunks (COCA Spoken / NGSL / SUBTLEX-US). */
export const US_PHRASES: Record<string, Gloss> = {
  "a lot of": { meaningKo: "많은", meaningEn: "many / much", ipa: "/ə lɑːt əv/" },
  "a bunch of": { meaningKo: "잔뜩, 여러", meaningEn: "a lot of (informal)", ipa: "/ə bʌntʃ əv/" },
  "a couple of": { meaningKo: "두어 개의", meaningEn: "two or a few", ipa: "/ə ˈkʌpl əv/" },
  "a little bit": { meaningKo: "조금", meaningEn: "slightly; a small amount", ipa: "/ə ˈlɪtl bɪt/" },
  "a few years": { meaningKo: "몇 년", meaningEn: "several years", ipa: "/ə fjuː jɪrz/" },
  "kind of": { meaningKo: "일종의, 좀", meaningEn: "somewhat; a type of", ipa: "/kaɪnd əv/" },
  "sort of": { meaningKo: "일종의, 약간", meaningEn: "somewhat", ipa: "/sɔːrt əv/" },
  "pretty much": { meaningKo: "거의", meaningEn: "almost completely", ipa: "/ˈprɪti mʌtʃ/" },
  "going to": { meaningKo: "~할 것이다", meaningEn: "future plan / will", ipa: "/ˈɡoʊɪŋ tə/" },
  "have to": { meaningKo: "~해야 한다", meaningEn: "must", ipa: "/hæv tə/" },
  "used to": { meaningKo: "예전에 ~했다", meaningEn: "did regularly in the past", ipa: "/juːst tə/" },
  "want to": { meaningKo: "~하고 싶다", meaningEn: "wish to", ipa: "/ˈwɑːnə/" },
  "figure out": { meaningKo: "알아내다, 해결하다", meaningEn: "understand or solve", ipa: "/ˈfɪɡjər aʊt/" },
  "find out": { meaningKo: "알아내다", meaningEn: "learn / discover", ipa: "/faɪnd aʊt/" },
  "end up": { meaningKo: "결국 ~하게 되다", meaningEn: "finally be/do", ipa: "/end ʌp/" },
  "come up with": { meaningKo: "생각해 내다", meaningEn: "invent or suggest", ipa: "/kʌm ʌp wɪð/" },
  "show up": { meaningKo: "나타나다", meaningEn: "arrive / appear", ipa: "/ʃoʊ ʌp/" },
  "work out": { meaningKo: "잘 되다, 운동하다", meaningEn: "succeed; exercise", ipa: "/wɜːrk aʊt/" },
  "deal with": { meaningKo: "다루다, 처리하다", meaningEn: "handle", ipa: "/diːl wɪð/" },
  "make sure": { meaningKo: "꼭 확인하다", meaningEn: "check so it happens", ipa: "/meɪk ʃʊr/" },
  "look ahead": { meaningKo: "앞을 내다보다", meaningEn: "think about the future", ipa: "/lʊk əˈhed/" },
  "go wrong": { meaningKo: "잘못되다", meaningEn: "fail or become a problem", ipa: "/ɡoʊ rɔːŋ/" },
  "in fact": { meaningKo: "사실", meaningEn: "actually", ipa: "/ɪn fækt/" },
  "of course": { meaningKo: "물론", meaningEn: "naturally; yes", ipa: "/əv kɔːrs/" },
  "at least": { meaningKo: "적어도", meaningEn: "not less than; anyway", ipa: "/æt liːst/" },
  "at all": { meaningKo: "전혀", meaningEn: "in any way (often with not)", ipa: "/æt ɔːl/" },
  "by the way": { meaningKo: "그런데", meaningEn: "incidentally", ipa: "/baɪ ðə weɪ/" },
  "in order to": { meaningKo: "~하기 위해", meaningEn: "so as to", ipa: "/ɪn ˈɔːrdər tə/" },
  "as soon as": { meaningKo: "~하자마자", meaningEn: "immediately after", ipa: "/æz suːn æz/" },
  "even though": { meaningKo: "~임에도", meaningEn: "despite the fact that", ipa: "/ˈiːvn ðoʊ/" },
  "as long as": { meaningKo: "~하는 한", meaningEn: "provided that", ipa: "/æz lɔːŋ æz/" },
  "instead of": { meaningKo: "~ 대신에", meaningEn: "in place of", ipa: "/ɪnˈsted əv/" },
  "because of": { meaningKo: "~ 때문에", meaningEn: "due to", ipa: "/bɪˈkɔːz əv/" },
  "according to": { meaningKo: "~에 따르면", meaningEn: "as said by", ipa: "/əˈkɔːrdɪŋ tə/" },
  "in terms of": { meaningKo: "~의 면에서", meaningEn: "regarding", ipa: "/ɪn tɜːrmz əv/" },
  "on the other hand": { meaningKo: "반면에", meaningEn: "from the opposite view", ipa: "/ɑːn ði ˈʌðər hænd/" },
  "at the same time": { meaningKo: "동시에", meaningEn: "meanwhile; however", ipa: "/æt ðə seɪm taɪm/" },
  "right now": { meaningKo: "지금 당장", meaningEn: "at this moment", ipa: "/raɪt naʊ/" },
  "for sure": { meaningKo: "확실히", meaningEn: "definitely", ipa: "/fər ʃʊr/" },
  "put in place": { meaningKo: "마련하다, 도입하다", meaningEn: "set up a system", ipa: "/pʊt ɪn pleɪs/" },
  "under stress": { meaningKo: "스트레스 상황에서", meaningEn: "while stressed", ipa: "/ˈʌndər stres/" },
  "heart rate": { meaningKo: "심박수", meaningEn: "how fast the heart beats", ipa: "/hɑːrt reɪt/" },
  "common sense": { meaningKo: "상식", meaningEn: "practical good judgment", ipa: "/ˈkɑːmən sens/" },
  "make sense": { meaningKo: "이해가 되다", meaningEn: "be logical", ipa: "/meɪk sens/" },
  "take place": { meaningKo: "일어나다", meaningEn: "happen", ipa: "/teɪk pleɪs/" },
  "in advance": { meaningKo: "미리", meaningEn: "beforehand", ipa: "/ɪn ədˈvæns/" },
  "next morning": { meaningKo: "다음 날 아침", meaningEn: "the following morning", ipa: "/nekst ˈmɔːrnɪŋ/" },
  "broke into": { meaningKo: "침입하다", meaningEn: "entered by force", ipa: "/broʊk ˈɪntu/" },
  "figure": { meaningKo: "생각하다, 숫자", meaningEn: "think; a number", ipa: "/ˈfɪɡjər/" },
};

/** Content lemmas frequent in American conversation / talks. */
export const US_WORDS: Record<string, Gloss> = {
  actually: { meaningKo: "사실은, 실제로", meaningEn: "in fact", ipa: "/ˈæktʃuəli/" },
  already: { meaningKo: "이미", meaningEn: "before now", ipa: "/ɔːlˈredi/" },
  almost: { meaningKo: "거의", meaningEn: "nearly", ipa: "/ˈɔːlmoʊst/" },
  always: { meaningKo: "항상", meaningEn: "every time", ipa: "/ˈɔːlweɪz/" },
  around: { meaningKo: "대략, 주위에", meaningEn: "approximately; nearby", ipa: "/əˈraʊnd/" },
  ask: { meaningKo: "묻다, 요청하다", meaningEn: "request information", ipa: "/æsk/" },
  because: { meaningKo: "왜냐하면", meaningEn: "for the reason that", ipa: "/bɪˈkɔːz/" },
  before: { meaningKo: "전에", meaningEn: "earlier than", ipa: "/bɪˈfɔːr/" },
  better: { meaningKo: "더 나은", meaningEn: "improved; more good", ipa: "/ˈbetər/" },
  between: { meaningKo: "사이에", meaningEn: "in the middle of", ipa: "/bɪˈtwiːn/" },
  brain: { meaningKo: "뇌", meaningEn: "the organ that thinks", ipa: "/breɪn/" },
  break: { meaningKo: "깨다, 휴식", meaningEn: "smash; a pause", ipa: "/breɪk/" },
  business: { meaningKo: "사업, 일", meaningEn: "company; work", ipa: "/ˈbɪznəs/" },
  call: { meaningKo: "부르다, 전화하다", meaningEn: "name; phone", ipa: "/kɔːl/" },
  change: { meaningKo: "바꾸다, 변화", meaningEn: "make different", ipa: "/tʃeɪndʒ/" },
  clear: { meaningKo: "분명한, 맑은", meaningEn: "easy to understand", ipa: "/klɪr/" },
  close: { meaningKo: "가까운, 닫다", meaningEn: "near; shut", ipa: "/kloʊs/" },
  conversation: { meaningKo: "대화", meaningEn: "talk between people", ipa: "/ˌkɑːnvərˈseɪʃn/" },
  decision: { meaningKo: "결정", meaningEn: "a choice", ipa: "/dɪˈsɪʒn/" },
  different: { meaningKo: "다른", meaningEn: "not the same", ipa: "/ˈdɪfrənt/" },
  disaster: { meaningKo: "재난, 큰 실패", meaningEn: "a sudden failure or accident", ipa: "/dɪˈzæstər/" },
  doctor: { meaningKo: "의사", meaningEn: "a medical professional", ipa: "/ˈdɑːktər/" },
  early: { meaningKo: "이른", meaningEn: "before the usual time", ipa: "/ˈɜːrli/" },
  enough: { meaningKo: "충분한", meaningEn: "as much as needed", ipa: "/ɪˈnʌf/" },
  especially: { meaningKo: "특히", meaningEn: "more than usual", ipa: "/ɪˈspeʃəli/" },
  everyone: { meaningKo: "모두", meaningEn: "every person", ipa: "/ˈevriwʌn/" },
  example: { meaningKo: "예시", meaningEn: "a sample case", ipa: "/ɪɡˈzæmpl/" },
  expensive: { meaningKo: "비싼", meaningEn: "costing a lot", ipa: "/ɪkˈspensɪv/" },
  experience: { meaningKo: "경험", meaningEn: "what you have lived through", ipa: "/ɪkˈspɪriəns/" },
  explain: { meaningKo: "설명하다", meaningEn: "make clear", ipa: "/ɪkˈspleɪn/" },
  fact: { meaningKo: "사실", meaningEn: "something true", ipa: "/fækt/" },
  family: { meaningKo: "가족", meaningEn: "parents and children", ipa: "/ˈfæməli/" },
  figure: { meaningKo: "생각하다, 수치", meaningEn: "suppose; a number", ipa: "/ˈfɪɡjər/" },
  follow: { meaningKo: "따르다", meaningEn: "go after; understand", ipa: "/ˈfɑːloʊ/" },
  forget: { meaningKo: "잊다", meaningEn: "fail to remember", ipa: "/fərˈɡet/" },
  happen: { meaningKo: "일어나다", meaningEn: "occur", ipa: "/ˈhæpən/" },
  important: { meaningKo: "중요한", meaningEn: "of great value", ipa: "/ɪmˈpɔːrtnt/" },
  information: { meaningKo: "정보", meaningEn: "facts you can use", ipa: "/ˌɪnfərˈmeɪʃn/" },
  instead: { meaningKo: "대신에", meaningEn: "as an alternative", ipa: "/ɪnˈsted/" },
  keep: { meaningKo: "유지하다, 계속하다", meaningEn: "continue to have", ipa: "/kiːp/" },
  later: { meaningKo: "나중에", meaningEn: "after this", ipa: "/ˈleɪtər/" },
  likely: { meaningKo: "가능성이 있는", meaningEn: "probable", ipa: "/ˈlaɪkli/" },
  lose: { meaningKo: "잃다", meaningEn: "no longer have", ipa: "/luːz/" },
  maybe: { meaningKo: "아마", meaningEn: "perhaps", ipa: "/ˈmeɪbi/" },
  mean: { meaningKo: "의미하다", meaningEn: "signify; intend", ipa: "/miːn/" },
  medical: { meaningKo: "의료의", meaningEn: "about health care", ipa: "/ˈmedɪkl/" },
  memory: { meaningKo: "기억", meaningEn: "ability to remember", ipa: "/ˈmeməri/" },
  midnight: { meaningKo: "자정", meaningEn: "12 at night", ipa: "/ˈmɪdnaɪt/" },
  minimize: { meaningKo: "최소화하다", meaningEn: "make as small as possible", ipa: "/ˈmɪnɪmaɪz/" },
  morning: { meaningKo: "아침", meaningEn: "early part of the day", ipa: "/ˈmɔːrnɪŋ/" },
  number: { meaningKo: "숫자, 수", meaningEn: "a quantity", ipa: "/ˈnʌmbər/" },
  obvious: { meaningKo: "뻔한, 명백한", meaningEn: "easy to see or understand", ipa: "/ˈɑːbviəs/" },
  passport: { meaningKo: "여권", meaningEn: "travel ID document", ipa: "/ˈpæspɔːrt/" },
  people: { meaningKo: "사람들", meaningEn: "persons", ipa: "/ˈpiːpl/" },
  percent: { meaningKo: "퍼센트", meaningEn: "out of 100", ipa: "/pərˈsent/" },
  perhaps: { meaningKo: "아마도", meaningEn: "maybe", ipa: "/pərˈhæps/" },
  place: { meaningKo: "장소, 두다", meaningEn: "a location; put", ipa: "/pleɪs/" },
  practice: { meaningKo: "연습, 실행", meaningEn: "training; a custom", ipa: "/ˈpræktɪs/" },
  prevent: { meaningKo: "막다, 예방하다", meaningEn: "stop from happening", ipa: "/prɪˈvent/" },
  probably: { meaningKo: "아마", meaningEn: "very likely", ipa: "/ˈprɑːbəbli/" },
  problem: { meaningKo: "문제", meaningEn: "something wrong", ipa: "/ˈprɑːbləm/" },
  question: { meaningKo: "질문", meaningEn: "something you ask", ipa: "/ˈkwestʃən/" },
  rather: { meaningKo: "오히려, 다소", meaningEn: "instead; somewhat", ipa: "/ˈræðər/" },
  really: { meaningKo: "정말로, 매우", meaningEn: "truly; very", ipa: "/ˈrɪəli/" },
  reason: { meaningKo: "이유", meaningEn: "why something happens", ipa: "/ˈriːzn/" },
  remember: { meaningKo: "기억하다", meaningEn: "keep in mind", ipa: "/rɪˈmembər/" },
  right: { meaningKo: "맞다, 오른쪽", meaningEn: "correct; opposite of left", ipa: "/raɪt/" },
  science: { meaningKo: "과학", meaningEn: "study of how things work", ipa: "/ˈsaɪəns/" },
  several: { meaningKo: "여러", meaningEn: "more than two", ipa: "/ˈsevrəl/" },
  should: { meaningKo: "~해야 한다", meaningEn: "it is right to", ipa: "/ʃʊd/" },
  since: { meaningKo: "~이후로, ~때문에", meaningEn: "from that time; because", ipa: "/sɪns/" },
  situation: { meaningKo: "상황", meaningEn: "the conditions around you", ipa: "/ˌsɪtʃuˈeɪʃn/" },
  something: { meaningKo: "무언가", meaningEn: "an unspecified thing", ipa: "/ˈsʌmθɪŋ/" },
  sometimes: { meaningKo: "가끔", meaningEn: "not always", ipa: "/ˈsʌmtaɪmz/" },
  stress: { meaningKo: "스트레스, 강세", meaningEn: "pressure; emphasis", ipa: "/stres/" },
  suddenly: { meaningKo: "갑자기", meaningEn: "quickly and unexpectedly", ipa: "/ˈsʌdnli/" },
  system: { meaningKo: "시스템, 체계", meaningEn: "an organized method", ipa: "/ˈsɪstəm/" },
  thing: { meaningKo: "것, 일", meaningEn: "an object or matter", ipa: "/θɪŋ/" },
  though: { meaningKo: "비록 ~이지만", meaningEn: "however; although", ipa: "/ðoʊ/" },
  through: { meaningKo: "~을 통과하여", meaningEn: "from one side to the other", ipa: "/θruː/" },
  today: { meaningKo: "오늘", meaningEn: "this day", ipa: "/təˈdeɪ/" },
  together: { meaningKo: "함께", meaningEn: "with each other", ipa: "/təˈɡeðər/" },
  travel: { meaningKo: "여행하다", meaningEn: "go from place to place", ipa: "/ˈtrævl/" },
  try: { meaningKo: "시도하다", meaningEn: "attempt", ipa: "/traɪ/" },
  until: { meaningKo: "~까지", meaningEn: "up to the time", ipa: "/ənˈtɪl/" },
  usually: { meaningKo: "보통", meaningEn: "most of the time", ipa: "/ˈjuːʒuəli/" },
  window: { meaningKo: "창문", meaningEn: "glass opening in a wall", ipa: "/ˈwɪndoʊ/" },
  winter: { meaningKo: "겨울", meaningEn: "the cold season", ipa: "/ˈwɪntər/" },
  without: { meaningKo: "~없이", meaningEn: "not having", ipa: "/wɪˈðaʊt/" },
  worry: { meaningKo: "걱정하다", meaningEn: "feel anxious", ipa: "/ˈwɜːri/" },
  wrong: { meaningKo: "잘못된", meaningEn: "not correct", ipa: "/rɔːŋ/" },
  cortisol: { meaningKo: "코르티솔", meaningEn: "a stress hormone", ipa: "/ˈkɔːrtɪsɔːl/" },
  adrenaline: { meaningKo: "아드레날린", meaningEn: "a stress chemical", ipa: "/əˈdrenəlɪn/" },
  cloudy: { meaningKo: "흐린, 멍한", meaningEn: "not clear", ipa: "/ˈklaʊdi/" },
  thinking: { meaningKo: "생각", meaningEn: "the process of thought", ipa: "/ˈθɪŋkɪŋ/" },
  house: { meaningKo: "집", meaningEn: "a home", ipa: "/haʊs/" },
  keys: { meaningKo: "열쇠", meaningEn: "tools that open locks", ipa: "/kiːz/" },
  airport: { meaningKo: "공항", meaningEn: "place planes take off", ipa: "/ˈerpɔːrt/" },
  flight: { meaningKo: "비행", meaningEn: "a plane trip", ipa: "/flaɪt/" },
  deadline: { meaningKo: "마감", meaningEn: "time something must be done", ipa: "/ˈdedlaɪn/" },
  panic: { meaningKo: "공포, 당황", meaningEn: "sudden fear", ipa: "/ˈpænɪk/" },
  college: { meaningKo: "대학", meaningEn: "university", ipa: "/ˈkɑːlɪdʒ/" },
  papers: { meaningKo: "과제, 논문", meaningEn: "school essays", ipa: "/ˈpeɪpərz/" },
  growth: { meaningKo: "성장", meaningEn: "an increase", ipa: "/ɡroʊθ/" },
  scale: { meaningKo: "규모", meaningEn: "size of an operation", ipa: "/skeɪl/" },
  margins: { meaningKo: "마진, 이익률", meaningEn: "profit as a share", ipa: "/ˈmɑːrdʒɪnz/" },
  commercial: { meaningKo: "상업의, 기업", meaningEn: "business / for-profit", ipa: "/kəˈmɜːrʃl/" },
  analysts: { meaningKo: "애널리스트", meaningEn: "people who study data", ipa: "/ˈænəlɪsts/" },
  expecting: { meaningKo: "예상하는", meaningEn: "thinking it will happen", ipa: "/ɪkˈspektɪŋ/" },
  elephant: { meaningKo: "코끼리", meaningEn: "a very large animal", ipa: "/ˈelɪfənt/" },
  trunks: { meaningKo: "코끼리 코", meaningEn: "an elephant's long nose", ipa: "/trʌŋks/" },
  cool: { meaningKo: "멋진, 괜찮은", meaningEn: "impressive; not warm", ipa: "/kuːl/" },
  front: { meaningKo: "앞", meaningEn: "the side facing you", ipa: "/frʌnt/" },
  baby: { meaningKo: "아기", meaningEn: "a very young child", ipa: "/ˈbeɪbi/" },
  shark: { meaningKo: "상어", meaningEn: "a large sea animal", ipa: "/ʃɑːrk/" },
  mommy: { meaningKo: "엄마", meaningEn: "mother (child word)", ipa: "/ˈmɑːmi/" },
  daddy: { meaningKo: "아빠", meaningEn: "father (child word)", ipa: "/ˈdædi/" },
  designate: { meaningKo: "지정하다", meaningEn: "officially choose", ipa: "/ˈdezɪɡneɪt/" },
  prospective: { meaningKo: "미래의, 예상되는", meaningEn: "expected in the future", ipa: "/prəˈspektɪv/" },
  hindsight: { meaningKo: "사후 판단", meaningEn: "understanding after the fact", ipa: "/ˈhaɪndsaɪt/" },
  psychologist: { meaningKo: "심리학자", meaningEn: "expert on the mind", ipa: "/saɪˈkɑːlədʒɪst/" },
  neuroscientist: { meaningKo: "신경과학자", meaningEn: "brain scientist", ipa: "/ˌnʊroʊˈsaɪəntɪst/" },
  modulate: { meaningKo: "조절하다", meaningEn: "adjust the level of", ipa: "/ˈmɑːdʒəleɪt/" },
  releases: { meaningKo: "분비하다, 방출하다", meaningEn: "lets out", ipa: "/rɪˈliːsɪz/" },
  damage: { meaningKo: "피해, 손상", meaningEn: "harm", ipa: "/ˈdæmɪdʒ/" },
  experts: { meaningKo: "전문가들", meaningEn: "people with skill", ipa: "/ˈekspərts/" },
  team: { meaningKo: "팀", meaningEn: "a group working together", ipa: "/tiːm/" },
  method: { meaningKo: "방법", meaningEn: "a way of doing something", ipa: "/ˈmeθəd/" },
  recognize: { meaningKo: "알아보다, 인정하다", meaningEn: "know again; accept", ipa: "/ˈrekəɡnaɪz/" },
};

const PHRASE_KEYS = Object.keys(US_PHRASES).sort((a, b) => b.length - a.length);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function sentenceWindow(lines: string[], index: number): string {
  const cur = lines[index] ?? "";
  if (wordCount(cur) >= 8) return cur;
  const prev = lines[index - 1] ?? "";
  const next = lines[index + 1] ?? "";
  return [prev, cur, next].filter(Boolean).join(" ").trim();
}

function pickExample(haystack: string, needle: string): string {
  const lower = haystack.toLowerCase();
  const at = lower.indexOf(needle.toLowerCase());
  if (at < 0) return haystack.slice(0, 140);
  const start = Math.max(0, haystack.lastIndexOf(".", at - 1) + 1);
  const endDot = haystack.indexOf(".", at + needle.length);
  const end = endDot > at ? endDot + 1 : Math.min(haystack.length, at + 90);
  return haystack.slice(start, end).trim();
}

export function extractVocabBank(
  captions: CaptionLine[],
  extra: VocabItem[] = [],
  limit = 16,
): VocabEntry[] {
  const lines = captions.map((c) => cleanCaptionText(c.text)).filter((t) => t && wordCount(t) > 0);
  const script = lines.join(" ");
  const lower = script.toLowerCase();
  const found = new Map<string, VocabEntry>();

  for (const v of extra) {
    const key = v.word.toLowerCase().trim();
    if (!key || found.has(key)) continue;
    found.set(key, {
      word: v.word,
      meaningKo: v.meaningKo,
      meaningEn: v.meaningEn || v.meaningKo,
      ipa: v.ipa,
      example: pickExample(script, key) || v.word,
      kind: key.includes(" ") ? "phrase" : "word",
    });
  }

  for (const phrase of PHRASE_KEYS) {
    if (found.size >= limit + 6) break;
    if (!lower.includes(phrase)) continue;
    if (found.has(phrase)) continue;
    const g = US_PHRASES[phrase]!;
    found.set(phrase, {
      word: phrase,
      meaningKo: g.meaningKo,
      meaningEn: g.meaningEn,
      ipa: g.ipa,
      example: pickExample(script, phrase).slice(0, 180),
      kind: "phrase",
    });
  }

  const counts = new Map<string, number>();
  for (const tok of tokenize(script)) {
    if (tok.length < 4 || STOP.has(tok) || /^\d+$/.test(tok)) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [tok] of ranked) {
    if (found.size >= limit + 8) break;
    const g = US_WORDS[tok];
    if (!g) continue;
    if (found.has(tok)) continue;
    found.set(tok, {
      word: tok,
      meaningKo: g.meaningKo,
      meaningEn: g.meaningEn,
      ipa: g.ipa,
      example: pickExample(script, tok).slice(0, 180),
      kind: "word",
    });
  }

  const list = [...found.values()];
  const phrases = list.filter((x) => x.kind === "phrase");
  const words = list.filter((x) => x.kind === "word");
  return [...phrases, ...words].slice(0, limit);
}

export function extractUsefulSentences(captions: CaptionLine[], limit = 8): { text: string; startSec: number; endSec: number }[] {
  const out: { text: string; startSec: number; endSec: number }[] = [];
  let buf = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    const n = wordCount(text);
    if (n >= 8 && n <= 28 && /[.!?]$/.test(text)) {
      out.push({ text, startSec: start, endSec: end });
    }
    buf = "";
  };
  for (const c of captions) {
    const t = cleanCaptionText(c.text);
    if (!t || SKIP_NOISE.test(t)) continue;
    if (!buf) start = c.start;
    buf = buf ? `${buf} ${t}` : t;
    end = c.start + Math.max(0.4, c.dur || 0);
    if (/[.!?]$/.test(t) || wordCount(buf) >= 22) flush();
    if (out.length >= limit) break;
  }
  if (out.length < 3) {
    for (const c of captions) {
      const t = cleanCaptionText(c.text);
      if (wordCount(t) >= 8) {
        out.push({
          text: t,
          startSec: c.start,
          endSec: c.start + Math.max(0.4, c.dur || 0),
        });
      }
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}

const SKIP_NOISE = /laughter|applause|music/i;

export type VocabQuizItem = {
  id: string;
  type: "meaning" | "cloze" | "produce";
  prompt: string;
  promptKo?: string;
  answer: string;
  choices: string[];
  hint?: string;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function buildVocabQuiz(bank: VocabEntry[], count = 10): VocabQuizItem[] {
  if (bank.length < 2) return [];
  const pool = shuffle(bank);
  const items: VocabQuizItem[] = [];
  const n = Math.min(count, bank.length);
  for (let i = 0; i < n; i++) {
    const entry = pool[i]!;
    const others = bank.filter((b) => b.word !== entry.word);
    const mode = i % 3;
    if (mode === 0) {
      const distractors = shuffle(others)
        .slice(0, 3)
        .map((d) => d.meaningKo);
      while (distractors.length < 3) distractors.push(["건너다", "예약하다", "포기하다", "섞다"][distractors.length]!);
      items.push({
        id: `m-${entry.word}`,
        type: "meaning",
        prompt: entry.word,
        promptKo: "이 말의 뜻은?",
        answer: entry.meaningKo,
        choices: shuffle([entry.meaningKo, ...distractors.slice(0, 3)]),
        hint: entry.ipa,
      });
    } else if (mode === 1 && entry.example.toLowerCase().includes(entry.word.toLowerCase())) {
      const re = new RegExp(entry.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const cloze = entry.example.replace(re, "_____");
      const distractors = shuffle(others)
        .slice(0, 3)
        .map((d) => d.word);
      while (distractors.length < 3) distractors.push(["anyway", "instead", "quickly", "usually"][distractors.length]!);
      items.push({
        id: `c-${entry.word}`,
        type: "cloze",
        prompt: cloze,
        promptKo: "빈칸에 들어갈 말은?",
        answer: entry.word,
        choices: shuffle([entry.word, ...distractors.slice(0, 3)]),
        hint: entry.meaningKo,
      });
    } else {
      const distractors = shuffle(others)
        .slice(0, 3)
        .map((d) => d.word);
      while (distractors.length < 3) distractors.push(["anyway", "instead", "quickly", "usually"][distractors.length]!);
      items.push({
        id: `p-${entry.word}`,
        type: "produce",
        prompt: entry.meaningKo,
        promptKo: "이 뜻에 맞는 영어는?",
        answer: entry.word,
        choices: shuffle([entry.word, ...distractors.slice(0, 3)]),
        hint: entry.meaningEn,
      });
    }
  }
  return items;
}

export { sentenceWindow };
