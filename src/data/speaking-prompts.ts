import type { AgeBand } from "@/lib/schema";

export type SpeakTurn = {
  id: string;
  partnerLine: string;
  hintKo: string;
  hintEn: string;
};

const CHILD: SpeakTurn[] = [
  {
    id: "c1",
    partnerLine: "Hi! What's your name?",
    hintKo: "이름만 말해도 됩니다.",
    hintEn: "A name is enough.",
  },
  {
    id: "c2",
    partnerLine: "What's your favorite color?",
    hintKo: "색깔 하나만 골라도 됩니다.",
    hintEn: "Name one color.",
  },
  {
    id: "c3",
    partnerLine: "What do you see?",
    hintKo: "보이는 것 하나만 말해 보세요.",
    hintEn: "Name one thing you can see.",
  },
  {
    id: "c4",
    partnerLine: "What did you eat today?",
    hintKo: "음식 이름이면 충분합니다.",
    hintEn: "One food is enough.",
  },
];

const TEEN: SpeakTurn[] = [
  {
    id: "t1",
    partnerLine: "Did you finish the homework?",
    hintKo: "했다 / 아직이다, 둘 중 하나로.",
    hintEn: "Yes or not yet.",
  },
  {
    id: "t2",
    partnerLine: "Want to get fries after school?",
    hintKo: "가자 / 못 간다 + 짧은 이유.",
    hintEn: "Yes or no, plus a short reason.",
  },
  {
    id: "t3",
    partnerLine: "Why were you late?",
    hintKo: "늦은 이유를 한 가지만.",
    hintEn: "Give one reason.",
  },
  {
    id: "t4",
    partnerLine: "Recommend something. What should we watch?",
    hintKo: "제목 하나와, 왜 좋은지 한 마디.",
    hintEn: "One title, and one why.",
  },
];

const COLLEGE: SpeakTurn[] = [
  {
    id: "u1",
    partnerLine: "Can I borrow your charger for an hour?",
    hintKo: "빌려주기 / 지금은 어렵다는 말.",
    hintEn: "Yes, or a polite no.",
  },
  {
    id: "u2",
    partnerLine: "What part of the assignment is confusing?",
    hintKo: "어느 부분이 안 되는지 하나만.",
    hintEn: "Name the part that is stuck.",
  },
  {
    id: "u3",
    partnerLine: "Is everything okay with your drink?",
    hintKo: "주문과 다르다는 점을 부드럽게.",
    hintEn: "Say this is not what you ordered, politely.",
  },
  {
    id: "u4",
    partnerLine: "Tell us who you are and why you joined.",
    hintKo: "이름, 그리고 온 이유 하나.",
    hintEn: "Your name, and one reason you came.",
  },
];

const ADULT: SpeakTurn[] = [
  {
    id: "a1",
    partnerLine: "Hey — we already started. Everything okay?",
    hintKo: "미안함 + 늦은 이유 하나.",
    hintEn: "An apology, plus one reason.",
  },
  {
    id: "a2",
    partnerLine: "How's the drink? Need anything else?",
    hintKo: "주문과 다르다는 점을 기분 나쁘지 않게.",
    hintEn: "Point out the mix-up without sounding angry.",
  },
  {
    id: "a3",
    partnerLine: "How can I help you?",
    hintKo: "무엇을 원하는지 한 문장으로.",
    hintEn: "Say what you need in one sentence.",
  },
  {
    id: "a4",
    partnerLine: "Give us a 20-second status. Why the delay, and what's next?",
    hintKo: "이유 하나, 다음에 할 일 하나.",
    hintEn: "One reason, then one next step.",
  },
];

export function speakingTurnsFor(age: AgeBand): SpeakTurn[] {
  if (age === "child") return CHILD;
  if (age === "teen") return TEEN;
  if (age === "college") return COLLEGE;
  return ADULT;
}
