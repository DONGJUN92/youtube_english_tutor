export type AgeBand = "child" | "teen" | "college" | "adult";
export type PlacementSkill = "listening" | "vocab" | "grammar" | "reading";
export type ItemPart = "part2" | "part3" | "part4" | "part5" | "part6" | "part7";

export { PLACEMENT_BANK_VERSION } from "./placement-version";

export type PlacementItem = {
  id: string;
  difficulty: number;
  ages: AgeBand[];
  skill: PlacementSkill;
  part: ItemPart;
  timeLimitSec: number;
  audioText?: string;
  passage?: string;
  promptKo: string;
  promptEn: string;
  stem?: string;
  choices: string[];
  answerIndex: number;
  nextCorrect: string;
  nextWrong: string;
};

type Draft = Omit<PlacementItem, "nextCorrect" | "nextWrong" | "timeLimitSec">;

const K: AgeBand[] = ["child"];
const KT: AgeBand[] = ["child", "teen"];
const T: AgeBand[] = ["teen", "college", "adult"];
const A: AgeBand[] = ["college", "adult"];
const ALL: AgeBand[] = ["child", "teen", "college", "adult"];
const TA: AgeBand[] = ["teen", "college", "adult"];

/**
 * Generous clocks — not exam-tight.
 * Listening includes time to hear the clip twice; reading includes time to reread.
 */
export function timeLimitFor(part: ItemPart, difficulty: number): number {
  const base: Record<ItemPart, number> = {
    part2: 60,
    part3: 90,
    part4: 95,
    part5: 55,
    part6: 100,
    part7: 125,
  };
  return base[part] + Math.max(0, difficulty - 1) * 3;
}

function P2(
  id: string,
  d: number,
  ages: AgeBand[],
  audio: string,
  choices: [string, string, string],
  a: 0 | 1 | 2,
): Draft {
  return {
    id,
    difficulty: d,
    ages,
    skill: "listening",
    part: "part2",
    audioText: audio,
    promptKo: "질문을 듣고 이어질 말로 가장 적절한 것을 고르십시오.",
    promptEn: "Listen to the question and choose the best response.",
    choices: [...choices],
    answerIndex: a,
  };
}

function P3(
  id: string,
  d: number,
  ages: AgeBand[],
  audio: string,
  qKo: string,
  qEn: string,
  choices: [string, string, string, string],
  a: 0 | 1 | 2 | 3,
): Draft {
  return {
    id,
    difficulty: d,
    ages,
    skill: "listening",
    part: "part3",
    audioText: audio,
    promptKo: qKo,
    promptEn: qEn,
    choices: [...choices],
    answerIndex: a,
  };
}

function P4(
  id: string,
  d: number,
  ages: AgeBand[],
  audio: string,
  qKo: string,
  qEn: string,
  choices: [string, string, string, string],
  a: 0 | 1 | 2 | 3,
): Draft {
  return {
    id,
    difficulty: d,
    ages,
    skill: "listening",
    part: "part4",
    audioText: audio,
    promptKo: qKo,
    promptEn: qEn,
    choices: [...choices],
    answerIndex: a,
  };
}

function P5(
  id: string,
  d: number,
  ages: AgeBand[],
  skill: "grammar" | "vocab",
  stem: string,
  choices: [string, string, string, string],
  a: 0 | 1 | 2 | 3,
): Draft {
  return {
    id,
    difficulty: d,
    ages,
    skill,
    part: "part5",
    promptKo: "다음 문장의 빈칸에 들어갈 말로 가장 적절한 것을 고르십시오.",
    promptEn: "Choose the word or phrase that best completes the sentence.",
    stem,
    choices: [...choices],
    answerIndex: a,
  };
}

function P6(
  id: string,
  d: number,
  ages: AgeBand[],
  skill: "grammar" | "vocab",
  passage: string,
  choices: [string, string, string, string],
  a: 0 | 1 | 2 | 3,
): Draft {
  return {
    id,
    difficulty: d,
    ages,
    skill,
    part: "part6",
    passage,
    promptKo: "다음 글의 빈칸에 들어갈 말로 가장 적절한 것을 고르십시오.",
    promptEn: "Choose the word or phrase that best completes the text.",
    choices: [...choices],
    answerIndex: a,
  };
}

function P7(
  id: string,
  d: number,
  ages: AgeBand[],
  passage: string,
  qKo: string,
  qEn: string,
  choices: [string, string, string, string],
  a: 0 | 1 | 2 | 3,
): Draft {
  return {
    id,
    difficulty: d,
    ages,
    skill: "reading",
    part: "part7",
    passage,
    promptKo: qKo,
    promptEn: qEn,
    choices: [...choices],
    answerIndex: a,
  };
}

/**
 * Original diagnostic items. Workplace + school contexts.
 * Not copied from copyrighted exam forms. Workplace + school contexts.
 */
const DRAFTS: Draft[] = [
  // —— 1  (~10–250) ——
  P5("t01", 1, ALL, "grammar", "Ms. Kim _____ a software engineer.", ["is", "are", "am", "be"], 0),
  P5("t02", 1, ALL, "grammar", "The meeting is _____ Monday morning.", ["on", "in", "at", "to"], 0),
  P2("t03", 1, ALL, "How are you today?", ["I'm fine, thank you.", "It's on the second floor.", "At two o'clock."], 0),
  P2("t04", 1, ALL, "Where is the restroom?", ["Down the hall on the left.", "Yes, I did.", "I'm a manager."], 0),
  P5("t05", 1, KT, "vocab", "Please _____ the window. It's cold.", ["close", "closely", "closure", "closed"], 0),
  P7(
    "t06",
    1,
    ALL,
    "NOTICE\nThe school library will be closed on Sunday.\nRegular hours: Monday–Saturday, 9:00 A.M.–6:00 P.M.",
    "도서관은 언제 닫혀 있습니까?",
    "When is the library closed?",
    ["On Sunday", "On Monday", "Every morning", "After 9:00 A.M."],
    0,
  ),
  P5("t07", 1, ALL, "grammar", "They _____ in the lobby now.", ["are waiting", "is waiting", "waits", "waited"], 0),
  P2("t08", 1, KT, "What time is it?", ["It's three o'clock.", "In the cafeteria.", "Yes, I can."], 0),
  P5("t09", 1, ALL, "grammar", "This _____ my office.", ["is", "are", "am", "be"], 0),
  P2("t10", 1, ALL, "Are you ready?", ["Yes, I am.", "It's ready-made.", "On the table."], 0),
  P4(
    "t11",
    1,
    ALL,
    "Good morning. The museum opens at ten and closes at six. Tickets are sold at the front desk.",
    "박물관은 몇 시에 문을 엽니까?",
    "What time does the museum open?",
    ["At 10:00", "At 6:00", "At noon", "At the front desk"],
    0,
  ),
  P5("t12", 1, KT, "vocab", "I _____ a student.", ["am", "is", "are", "be"], 0),

  // —— 2  (~250–350) ——
  P5("t13", 2, ALL, "grammar", "The train leaves _____ 8:30 A.M.", ["at", "on", "in", "by of"], 0),
  P5("t14", 2, ALL, "grammar", "I would like _____ cup of coffee.", ["a", "an", "the many", "some a"], 0),
  P2("t15", 2, ALL, "Can I help you?", ["Yes, I'm looking for the manager.", "She is tall.", "Yesterday morning."], 0),
  P3(
    "t16",
    2,
    ALL,
    "Woman: Are you ready to order? Man: Yes. I'll have the pasta, please.",
    "남자는 무엇을 주문합니까?",
    "What does the man order?",
    ["Pasta", "Soup only", "A ticket", "Coffee beans"],
    0,
  ),
  P5("t17", 2, TA, "grammar", "Please send the report _____ e-mail.", ["by", "on", "at", "from"], 0),
  P5("t18", 2, ALL, "vocab", "The store is _____ from 9 A.M. to 9 P.M.", ["open", "opened", "opener", "openly"], 0),
  P7(
    "t19",
    2,
    ALL,
    "Riverside Café\nHours: 7:00 A.M. – 8:00 P.M. daily\nClosed on national holidays.\nWi-Fi is free for customers.",
    "카페는 언제 문을 닫습니까?",
    "When is the café closed?",
    ["On national holidays", "Every Sunday", "After lunch only", "Never"],
    0,
  ),
  P2("t20", 2, TA, "Who is calling, please?", ["This is Mr. Park from accounting.", "It's next to the elevator.", "About twenty minutes."], 0),
  P5("t21", 2, KT, "vocab", "Please _____ your name on the form.", ["write", "writing", "written", "wrote"], 0),
  P5("t22", 2, ALL, "grammar", "There is _____ apple on the desk.", ["an", "a", "any", "much"], 0),
  P4(
    "t23",
    2,
    ALL,
    "Attention passengers. The next bus to City Hall leaves from Gate 4 in ten minutes. Please have your tickets ready.",
    "버스는 어디에서 출발합니까?",
    "Where does the bus leave from?",
    ["Gate 4", "City Hall", "In ten minutes", "The ticket office"],
    0,
  ),
  P7(
    "t24",
    2,
    K,
    "CLASS NOTICE\nArt class is on Wednesday at 4:00 P.M. in Room 12.\nPlease bring pencils.",
    "미술 수업은 언제입니까?",
    "When is art class?",
    ["Wednesday at 4:00 P.M.", "Room 12 only", "Tuesday morning", "Sunday"],
    0,
  ),
  P2("t25", 2, K, "What is your name?", ["My name is Mina.", "It is raining.", "On the table."], 0),

  // —— 3  (~350–450) ——
  P5("t26", 3, ALL, "grammar", "She _____ to the branch office yesterday.", ["went", "go", "goes", "going"], 0),
  P5("t27", 3, TA, "grammar", "There _____ several errors in the invoice.", ["are", "is", "has", "be"], 0),
  P2("t28", 3, TA, "Has the package arrived yet?", ["Not yet. It should be here this afternoon.", "It's a brown box.", "On the third floor."], 0),
  P3(
    "t29",
    3,
    TA,
    "Man: Do you have the sales figures for June? Woman: I just e-mailed them to you. Man: Great, thanks.",
    "여자는 무엇을 했습니까?",
    "What did the woman do?",
    ["E-mailed the sales figures", "Printed a map", "Cancelled a meeting", "Ordered lunch"],
    0,
  ),
  P5("t30", 3, TA, "vocab", "Please _____ a seat. Mr. Lee will see you shortly.", ["take", "make", "do", "bring"], 0),
  P5("t31", 3, ALL, "grammar", "This is _____ interesting article.", ["an", "a", "the most a", "some"], 0),
  P7(
    "t32",
    3,
    TA,
    "MEMO\nTo: All staff\nFrom: Human Resources\nThe staff picnic will be held on Saturday, May 12, at Lake Park. Please sign up in the break room by Friday.",
    "직원들은 언제까지 신청해야 합니까?",
    "By when should staff sign up?",
    ["Friday", "Saturday", "May 12 only", "Next month"],
    0,
  ),
  P2("t33", 3, KT, "Could you open the window?", ["Of course.", "It's a window.", "At noon."], 0),
  P5("t34", 3, TA, "vocab", "The hotel is located _____ the airport.", ["near", "nearly", "nearest", "nearing"], 0),
  P5("t35", 3, KT, "grammar", "He _____ breakfast every morning.", ["eats", "eat", "eating", "eaten"], 0),
  P4(
    "t36",
    3,
    TA,
    "Thank you for calling Westfield Clinic. We are open weekdays from 8 A.M. to 5 P.M. For medical emergencies, please hang up and dial 911.",
    "응급 상황일 때 청취자는 무엇을 해야 합니까?",
    "What should a caller do in a medical emergency?",
    ["Hang up and dial 911", "Leave a voicemail", "Visit after 5 P.M.", "Wait on the line"],
    0,
  ),
  P7(
    "t37",
    3,
    KT,
    "LOST AND FOUND\nA blue umbrella was found in the cafeteria on Tuesday. Please collect it from the front desk with an ID.",
    "우산은 어디에서 찾을 수 있습니까?",
    "Where can the umbrella be collected?",
    ["The front desk", "The cafeteria only", "A classroom", "Outside the building"],
    0,
  ),
  P6(
    "t38",
    3,
    ALL,
    "grammar",
    "Welcome to Oak Street Hotel. Check-in _____ at 3:00 P.M. Please bring a photo ID to the front desk.",
    ["begins", "begin", "beginning", "begun"],
    0,
  ),

  // —— 4  (~450–550) ——
  P5("t39", 4, TA, "grammar", "The new brochure will be _____ next Monday.", ["distributed", "distribution", "distributing", "distribute"], 0),
  P5("t40", 4, TA, "grammar", "Ms. Chen has been with the company _____ 2019.", ["since", "for", "during", "until"], 0),
  P2("t41", 4, TA, "Would you like me to reserve a table?", ["Yes, for two people at seven.", "The table is wooden.", "In the catalog."], 0),
  P3(
    "t42",
    4,
    TA,
    "Woman: The printer on the second floor is jammed again. Man: I'll call maintenance. They fixed it last week. Woman: Thanks. I have to print the client proposal by noon.",
    "여자는 왜 급합니까?",
    "Why is the woman in a hurry?",
    ["She must print a proposal by noon", "She is late for a flight", "The office is closing", "She lost a client file"],
    0,
  ),
  P5("t43", 4, TA, "vocab", "All visitors must _____ at the front desk.", ["register", "registration", "registered", "registering"], 0),
  P5("t44", 4, T, "grammar", "If it _____ tomorrow, the tour will be postponed.", ["rains", "rain", "will rain", "rained"], 0),
  P6(
    "t45",
    4,
    TA,
    "grammar",
    "To: Project Team\nFrom: Dana Cole\nSubject: Friday workshop\n\nPlease arrive by 8:45 A.M. The workshop _____ at 9:00 sharp, and late arrivals will miss the opening remarks.",
    ["begins", "begin", "beginning", "begun"],
    0,
  ),
  P7(
    "t46",
    4,
    TA,
    "Northline Bus\nPassengers traveling to Springfield on May 3 should note that departure has been moved from 2:00 P.M. to 3:30 P.M. because of road construction. Tickets remain valid. For refunds, call customer service.",
    "출발 시간이 바뀐 이유는 무엇입니까?",
    "Why was the departure time changed?",
    ["Road construction", "A sold-out bus", "Bad weather", "A holiday schedule"],
    0,
  ),
  P2("t47", 4, T, "How long have you worked here?", ["For about three years.", "On the fifth floor.", "I'm taking the bus."], 0),
  P5("t48", 4, T, "vocab", "The flight was _____ due to fog.", ["delayed", "delay", "delaying", "delays"], 0),
  P3(
    "t49",
    4,
    T,
    "Man: I left my badge at home. Woman: You can get a visitor pass at reception. Man: Thanks. I have a meeting with Ms. Cho at ten.",
    "남자는 무엇을 해야 합니까?",
    "What should the man do?",
    ["Get a visitor pass at reception", "Go home for his badge immediately", "Cancel the meeting", "Call Ms. Cho to postpone"],
    0,
  ),
  P4(
    "t50",
    4,
    TA,
    "This is a reminder that Building C will lose power this Saturday from 6 A.M. to 2 P.M. for electrical upgrades. Please save your files on Friday. The cafeteria will remain open.",
    "직원들이 금요일에 해야 할 일은 무엇입니까?",
    "What should employees do on Friday?",
    ["Save their files", "Stay home all day", "Use Building C as usual", "Close the cafeteria"],
    0,
  ),
  P5("t51", 4, TA, "grammar", "Please speak _____ so everyone can hear you.", ["clearly", "clear", "cleared", "clearness"], 0),

  // —— 5  (~550–650) ——
  P5("t52", 5, TA, "grammar", "The manager suggested that we _____ the deadline.", ["extend", "extends", "extending", "to extend"], 0),
  P5("t53", 5, TA, "vocab", "Please keep me _____ of any schedule changes.", ["informed", "inform", "information", "informative"], 0),
  P2("t54", 5, TA, "Do you mind if I sit here?", ["Not at all. Go ahead.", "It's a chair.", "After the meeting ended."], 0),
  P3(
    "t55",
    5,
    TA,
    "Man: I can't find a flight that arrives before the conference. Woman: Have you checked the 6 A.M. departure from Chicago? Man: That might work. I'll book it if seats are still available.",
    "남자는 다음에 무엇을 할 가능성이 큽니까?",
    "What is the man likely to do next?",
    ["Book an early morning flight", "Cancel the conference", "Drive to Chicago", "Change the meeting room"],
    0,
  ),
  P5("t56", 5, A, "grammar", "Neither of the proposals _____ acceptable.", ["is", "are", "have", "were being"], 0),
  P5("t57", 5, TA, "vocab", "The company plans to _____ its operations in Southeast Asia.", ["expand", "expansion", "expansive", "expanded"], 0),
  P6(
    "t58",
    5,
    TA,
    "vocab",
    "Dear Ms. Ortiz,\nThank you for your application. We would like to invite you to an interview on June 4 at 10:00 A.M. Please _____ to this e-mail to confirm that you can attend.",
    ["reply", "repeat", "replace", "reprint"],
    0,
  ),
  P7(
    "t59",
    5,
    TA,
    "E-mail\nFrom: Facilities\nTo: All employees\nThe east parking lot will be closed next week for resurfacing. Use the Oak Street garage. Daily parking fees will be waived during the closure. Carpool spaces remain open behind Building B.",
    "다음 주 주차 요금은 어떻게 됩니까?",
    "What will happen to parking fees next week?",
    ["They will be waived at the Oak Street garage", "They will double", "Only visitors will pay", "Fees move to Building B"],
    0,
  ),
  P5("t60", 5, T, "grammar", "He is used to _____ long hours.", ["working", "work", "worked", "works"], 0),
  P6(
    "t61",
    5,
    T,
    "grammar",
    "All employees are _____ to wear a badge while on site. Temporary badges are available at security.",
    ["required", "require", "requiring", "requirement"],
    0,
  ),
  P4(
    "t62",
    5,
    A,
    "Welcome to the annual sales conference. Today's keynote begins at 9:15 in Hall B, not Hall A as printed in your booklet. Lunch is at 12:30 in the courtyard. Workshops start at 2:00. Please silence your phones.",
    "기조연설은 어디에서 합니까?",
    "Where will the keynote take place?",
    ["Hall B", "Hall A", "The courtyard", "The booklet office"],
    0,
  ),
  P5("t63", 5, TA, "vocab", "The product was _____ last month and is already popular.", ["launched", "launch", "launching", "launcher"], 0),
  P2("t64", 5, TA, "When is the report due?", ["By Friday afternoon.", "It's a long report.", "In the conference room."], 0),

  // —— 6  (~650–730) ——
  P5("t65", 6, TA, "grammar", "The contract must be signed _____ Friday at the latest.", ["by", "until", "since", "during"], 0),
  P5("t66", 6, A, "vocab", "We apologize for any _____ the delay may have caused.", ["inconvenience", "inconvenient", "inconveniently", "convene"], 0),
  P2("t67", 6, TA, "Would you happen to know when the shipment is due?", ["It should arrive on Thursday.", "It's a large shipment.", "Yes, I shipped it myself last year."], 0),
  P3(
    "t68",
    6,
    A,
    "Woman: The client wants the revised estimate by tomorrow morning. Man: I can stay late tonight, but I'll need the updated labor costs. Woman: Accounting said they'll send those before five.",
    "남자는 견적을 마치려면 무엇이 필요합니까?",
    "What does the man need in order to finish the estimate?",
    ["Updated labor costs", "A new client list", "Permission to leave early", "Tomorrow's flight number"],
    0,
  ),
  P5("t69", 6, A, "grammar", "_____ the rain, the outdoor ceremony went ahead as planned.", ["Despite", "Although", "Because", "Unless"], 0),
  P5("t70", 6, TA, "vocab", "Please _____ a reservation at least two days in advance.", ["make", "do", "take", "have"], 0),
  P6(
    "t71",
    6,
    A,
    "grammar",
    "The board has reviewed the quarterly results. _____ sales rose in Europe, they declined slightly in North America, so overall revenue was unchanged.",
    ["Although", "Despite", "Because of", "During"],
    0,
  ),
  P7(
    "t72",
    6,
    A,
    "Job posting — Shift Supervisor, Harborview Hotel\nRequirements: two years of hospitality experience and evening availability. The role includes training new staff and handling guest complaints. Apply online by March 18. Only shortlisted candidates will be contacted.",
    "지원자가 반드시 갖춰야 할 것은 무엇입니까?",
    "What is required of applicants?",
    ["Hospitality experience and evening availability", "A university degree in finance", "Weekend-only availability", "Fluency in three languages"],
    0,
  ),
  P5("t73", 6, TA, "grammar", "The documents _____ on your desk this morning.", ["were placed", "placed", "were placing", "have placing"], 0),
  P5("t74", 6, T, "grammar", "She is looking forward to _____ you.", ["meeting", "meet", "met", "meets"], 0),
  P4(
    "t75",
    6,
    A,
    "This is an announcement for Lakeview Mall shoppers. The east entrance is closed today for repairs. Please use the south entrance near the grocery store. Free parking is available in Lot C. The mall closes at 9 P.M.",
    "오늘 쇼핑객은 어느 출입구를 이용해야 합니까?",
    "Which entrance should shoppers use today?",
    ["The south entrance", "The east entrance", "Lot C only", "The grocery loading dock"],
    0,
  ),
  P5("t76", 6, A, "vocab", "Please submit your _____ by the end of the week.", ["application", "apply", "applicable", "applicant"], 0),
  P2("t77", 6, TA, "Is this seat taken?", ["No, it's free.", "It's a window seat.", "I sat down yesterday."], 0),

  // —— 7  (~730–800) ——
  P5("t78", 7, A, "grammar", "Had the team submitted the files earlier, the error _____ avoided.", ["could have been", "can be", "will be", "is being"], 0),
  P5("t79", 7, A, "vocab", "The merger is still _____ regulatory approval.", ["pending", "pending of", "suspend", "remainder"], 0),
  P2(
    "t80",
    7,
    A,
    "I was wondering if you could cover my shift on Friday.",
    ["I would, but I'm already booked that day.", "The shift is eight hours.", "Friday is a weekday."],
    0,
  ),
  P3(
    "t81",
    7,
    A,
    "Man: We may have to push back the product launch. The safety tests aren't complete. Woman: Marketing has already booked the venue for the 12th. Man: Then let's keep the date but limit the demo to the features we've already cleared.",
    "남자는 무엇을 제안합니까?",
    "What does the man propose?",
    ["Keep the date but limit the demonstration", "Cancel the venue booking", "Skip the safety tests", "Launch a month earlier"],
    0,
  ),
  P5("t82", 7, A, "grammar", "The intern, _____ work has been outstanding, will be offered a full-time role.", ["whose", "who", "which", "whom"], 0),
  P5("t83", 7, A, "vocab", "Travel expenses will be _____ upon submission of receipts.", ["reimbursed", "reimbursement", "reimbursing", "reimburse"], 0),
  P6(
    "t84",
    7,
    A,
    "vocab",
    "To remain competitive, the firm must _____ its aging equipment. A phased replacement over 18 months is recommended so production is not interrupted.",
    ["upgrade", "upgraded", "upgrading", "upgrades"],
    0,
  ),
  P7(
    "t85",
    7,
    A,
    "From: Legal\nTo: Sales\nPlease do not promise delivery dates in writing until warehouse confirms stock. Last quarter, two contracts had to be amended because verbal estimates were treated as guarantees. Attach the standard disclaimer if a customer insists on a letter.",
    "영업팀이 서면으로 해서는 안 되는 일은 무엇입니까?",
    "What should the sales team not do in writing?",
    ["Promise delivery dates before stock is confirmed", "Attach a disclaimer", "Ask Legal for help", "Amend old contracts"],
    0,
  ),
  P5("t86", 7, TA, "grammar", "I'd rather you _____ the client tomorrow.", ["called", "call", "calling", "to call"], 0),
  P5("t87", 7, A, "vocab", "The factory will be _____ for maintenance on Sunday.", ["idle", "idol", "ideal", "idly"], 0),
  P4(
    "t88",
    7,
    A,
    "Good afternoon. This is a traffic advisory from the city transit office. Because of the marathon, buses on Route 12 will not stop at Central Plaza between 7 A.M. and 2 P.M. this Sunday. Use Route 8 or the subway. Regular service resumes on Monday.",
    "일요일에 Route 12 버스가 서지 않는 곳은 어디입니까?",
    "Where will Route 12 buses not stop on Sunday?",
    ["Central Plaza", "The subway station", "The marathon finish line", "The transit office"],
    0,
  ),
  P5("t89", 7, A, "grammar", "The results will be announced _____ the board meeting.", ["after", "afterward", "after of", "after than"], 0),

  // —— 8  (~800–860) ——
  P5(
    "t90",
    8,
    A,
    "grammar",
    "Not only _____ the budget, but they also delivered ahead of schedule.",
    ["did they meet", "they met", "they did meet", "met they"],
    0,
  ),
  P5("t91", 8, A, "vocab", "Her duties are _____ with those of a senior analyst.", ["commensurate", "commentary", "commenced", "commended"], 0),
  P2(
    "t92",
    8,
    A,
    "Would it be possible to move our call to later in the afternoon?",
    ["Let me check my calendar and get back to you.", "The afternoon is after noon.", "I called you yesterday."],
    0,
  ),
  P3(
    "t93",
    8,
    A,
    "Woman: The printer vendor quoted us 12 percent above last year's rate. Man: That's steep. Did they mention a volume discount if we extend the contract to three years? Woman: They did, but only if we also buy the service package. I'm not sure that's worth it.",
    "여자는 서비스 패키지에 대해 어떻게 생각합니까?",
    "How does the woman feel about the service package?",
    ["She doubts it is worthwhile", "She wants to buy it immediately", "She thinks the quote is too low", "She already signed the contract"],
    0,
  ),
  P5("t94", 8, A, "grammar", "The guidelines require that every claim _____ documented.", ["be", "is being", "to be", "been"], 0),
  P5("t95", 8, A, "vocab", "The two reports are _____ identical except for the appendix.", ["virtually", "virtual", "virtue", "virtuously"], 0),
  P6(
    "t96",
    8,
    A,
    "grammar",
    "Demand has been uneven this quarter. _____, management has decided to freeze hiring until September, when the outlook should be clearer.",
    ["Consequently", "Otherwise", "Likewise", "Meanwhile only"],
    0,
  ),
  P7(
    "t97",
    8,
    A,
    "Harbor Freight — Service advisory\nEffective June 1, oversized cargo must be dropped off at Gate C, not Gate A. Drivers who arrive at Gate A will be redirected, which may add 40 minutes. Prepaid reservations are still checked in at the main office. Questions: ops@harborfreight.example",
    "6월 1일 이후 대형 화물은 어디에 내려야 합니까?",
    "Where must oversized cargo be dropped off after June 1?",
    ["Gate C", "Gate A", "The main office only", "Any available gate"],
    0,
  ),
  P5("t98", 8, A, "grammar", "Rarely _____ such a detailed proposal from a new vendor.", ["have we received", "we have received", "we received have", "did we receiving"], 0),
  P5("t99", 8, A, "vocab", "Please address any _____ to the accounts office.", ["inquiries", "requires", "acquisitions", "expires"], 0),
  P4(
    "t100",
    8,
    A,
    "Thank you for attending the product briefing. The software trial lasts 30 days and does not include phone support. E-mail tickets are answered within one business day. After the trial, plans start at $12 per user per month, billed annually. A 10 percent discount applies if you convert before the trial ends.",
    "체험 기간 동안 제공되지 않는 것은 무엇입니까?",
    "What is not included during the trial?",
    ["Phone support", "E-mail tickets", "The software itself", "A 30-day period"],
    0,
  ),
  P5("t101", 8, A, "grammar", "The committee has postponed the vote _____ further notice.", ["until", "since", "by", "during"], 0),
  P2("t102", 8, A, "Have you had a chance to look at the contract?", ["I did. I have a few questions about clause 4.", "The contract is paper.", "Yes, I have a chance every day."], 0),

  // —— 9  (~860–920) ——
  P5(
    "t103",
    9,
    A,
    "grammar",
    "_____ the committee approve the measure, implementation will begin in Q1.",
    ["Should", "If would", "Unless that", "Whether or"],
    0,
  ),
  P5("t104", 9, A, "vocab", "The CEO's remarks were _____ as a signal that layoffs are unlikely.", ["interpreted", "interrupted", "interspersed", "intercepted"], 0),
  P3(
    "t105",
    9,
    A,
    "Man: Finance wants us to cut the prototype budget by 15 percent. Woman: If we do that, we'll have to drop the field test in Austin. Man: Then we should present both options — a reduced lab-only test versus keeping Austin and trimming travel elsewhere.",
    "남자는 무엇을 제안합니까?",
    "What does the man suggest?",
    ["Present two budget options to Finance", "Cancel the entire prototype", "Ignore Finance's request", "Move the field test to another country"],
    0,
  ),
  P5("t106", 9, A, "grammar", "The figures, _____ last week, already look outdated.", ["released", "releasing", "were released", "have released"], 0),
  P5("t107", 9, A, "vocab", "Further discussion would be _____ until we have the lab results.", ["premature", "premier", "premium", "parameter"], 0),
  P6(
    "t108",
    9,
    A,
    "vocab",
    "The audit found no evidence of misconduct. It did, however, note several _____ in record-keeping that should be corrected before the next review.",
    ["lapses", "leases", "leaps", "lattices"],
    0,
  ),
  P7(
    "t109",
    9,
    A,
    "Internal note — Product naming\nDo not use “guaranteed” or “lifetime” in consumer copy unless Legal has signed off. Last year’s brochure was recalled after a competitor challenged a “lifetime” claim that applied only to the battery, not the device. Safer alternatives: “durable,” “long-lasting,” or a specific year range.",
    "작년에 브로슈어가 회수된 이유는 무엇입니까?",
    "Why was last year’s brochure recalled?",
    ["A lifetime claim was narrower than the wording suggested", "The battery was unsafe", "Legal approved the wrong logo", "A competitor copied the design"],
    0,
  ),
  P2(
    "t110",
    9,
    A,
    "I'm afraid we're not in a position to offer a discount on that volume.",
    ["I understand. I'll revise the order quantity.", "The discount is 10 percent.", "Volume is measured in liters."],
    0,
  ),
  P5("t111", 9, A, "grammar", "Little _____ that the supplier had already changed terms.", ["did we know", "we knew", "we did know", "knew we did"], 0),
  P4(
    "t112",
    9,
    A,
    "This is a recorded message from Northridge Utilities. To reduce peak demand, we will briefly interrupt power in Zone 3 between 2 and 4 P.M. tomorrow. Medical equipment users should notify us today at the number on your bill. This is not a billing notice, and no outage is planned for Zones 1 or 2.",
    "의료 기기를 쓰는 고객은 무엇을 해야 합니까?",
    "What should customers who use medical equipment do?",
    ["Call the number on their bill today", "Move to Zone 1 tomorrow", "Ignore the message", "Pay an extra fee"],
    0,
  ),
  P5("t113", 9, A, "vocab", "The two departments will _____ on the launch campaign.", ["collaborate", "collaboration", "collaborative", "collaborator"], 0),
  P6(
    "t114",
    9,
    A,
    "grammar",
    "The warehouse can store the extra inventory. _____, shipping from that site adds two days, so rush orders should still go out from the city depot.",
    ["However", "Therefore only", "Likewise", "In spite"],
    0,
  ),
  P5("t115", 9, A, "grammar", "No one objected to _____ the meeting.", ["postponing", "postpone", "postponed", "postpones"], 0),

  // —— 10  (~920–990) ——
  P5(
    "t116",
    10,
    A,
    "grammar",
    "_____ the delay, the shipment would have reached the warehouse on Tuesday.",
    ["But for", "But that", "Except if", "Without it that"],
    0,
  ),
  P5("t117", 10, A, "vocab", "The two policies are complementary rather than _____.", ["mutually exclusive", "mutually inclusive only", "mutual exclusive", "exclusive mutually"], 0),
  P3(
    "t118",
    10,
    A,
    "Woman: The consultant's timeline assumes overtime that our union contract doesn't allow. Man: Then the milestone dates in section 4 are not feasible as written. Woman: Exactly. We should send a marked-up copy rather than a blanket rejection — they may not know the constraint.",
    "여자는 왜 전면 거절 대신 수정본을 보내자고 합니까?",
    "Why does the woman prefer sending a marked-up copy?",
    ["The consultant may be unaware of the overtime limit", "The union has already approved overtime", "Section 4 is confidential", "A blanket rejection is required by Legal"],
    0,
  ),
  P5("t119", 10, A, "grammar", "The committee recommended that the clause _____ deleted.", ["be", "is", "was", "to be"], 0),
  P5("t120", 10, A, "vocab", "Those figures are _____ and should not be cited in the press release.", ["tentative", "tenacious", "tendentious", "tensile"], 0),
  P6(
    "t121",
    10,
    A,
    "grammar",
    "No sooner _____ the announcement been made than several clients requested meetings. The communications team is preparing a FAQ to keep the message consistent.",
    ["had", "has", "did", "was"],
    0,
  ),
  P7(
    "t122",
    10,
    A,
    "From: Compliance\nTo: Regional managers\nA recent review found that some branches recorded promotional discounts as operating expenses instead of contra-revenue. The distinction matters for margin reports used by investors. Correct entries for Q2 before the 15th; after that, restatements require CFO sign-off. Training slides are attached. This is a classification issue, not an allegation of misconduct.",
    "15일 이후에 수정을 하면 어떻게 됩니까?",
    "What happens if corrections are made after the 15th?",
    ["The CFO must sign off on restatements", "Branches are closed", "Investors are notified automatically", "The issue is treated as misconduct"],
    0,
  ),
  P5("t123", 10, A, "vocab", "The findings are interesting but hardly _____.", ["conclusive", "concluded", "concluding", "conclusion"], 0),
  P2(
    "t124",
    10,
    A,
    "Should I go ahead and brief the board, or wait until legal has reviewed the draft?",
    ["I'd hold off until legal signs off.", "The board meets on Tuesdays.", "Legal is on the fourth floor."],
    0,
  ),
  P4(
    "t125",
    10,
    A,
    "This is the quarterly briefing from Research. We are pausing the consumer panel in Q3, not cancelling it, because the sample frame needs to be rebuilt. Fieldwork will resume in October if recruitment hits 80 percent. Budget unused this quarter rolls to Q4. Do not brief the press; a statement will follow the board vote on the 21st.",
    "소비자 패널은 어떻게 됩니까?",
    "What is happening to the consumer panel?",
    ["It is paused in Q3, not cancelled", "It is cancelled permanently", "It starts immediately in July", "It is being briefed to the press today"],
    0,
  ),
  P5("t126", 10, A, "grammar", "So _____ the demand that the factory added a third shift.", ["great was", "was great", "great it was", "it great was"], 0),
  P5("t127", 10, A, "vocab", "Any remaining disputes will be settled by _____.", ["arbitration", "arbitrary", "arbiter only", "arbitrarily"], 0),
  P7(
    "t128",
    10,
    A,
    "Policy update — Remote work\nEffective September 1, employees in client-facing roles may work from home two days a week, down from three, unless a director approves an exception. The change follows client feedback about response times. Non-client teams keep the current three-day arrangement. Directors must log exceptions in the HR portal within five business days.",
    "고객 대면 직무의 재택 일수는 어떻게 바뀝니까?",
    "How does remote work change for client-facing roles?",
    ["It drops from three days to two unless a director makes an exception", "It increases to four days", "It is banned entirely", "It stays at three days like non-client teams"],
    0,
  ),
];

function shuffleChoices(d: Draft): Draft {
  const choices = [...d.choices];
  const correct = choices[d.answerIndex];
  let seed = 0;
  for (let i = 0; i < d.id.length; i++) seed = (seed * 31 + d.id.charCodeAt(i)) >>> 0;
  for (let i = choices.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = choices[i];
    choices[i] = choices[j];
    choices[j] = tmp;
  }
  return { ...d, choices, answerIndex: Math.max(0, choices.indexOf(correct)) };
}

function wire(drafts: Draft[]): PlacementItem[] {
  const byDiff = new Map<number, Draft[]>();
  for (const d of drafts) {
    const arr = byDiff.get(d.difficulty) ?? [];
    arr.push(d);
    byDiff.set(d.difficulty, arr);
  }
  const pick = (from: Draft, targetDiff: number, offset: number): string => {
    const bucket = byDiff.get(targetDiff);
    if (!bucket || bucket.length === 0) return "END";
    const sameAge = bucket.filter((x) => x.id !== from.id && x.ages.some((a) => from.ages.includes(a)));
    const pool = sameAge.length ? sameAge : bucket.filter((x) => x.id !== from.id);
    if (!pool.length) return "END";
    return pool[Math.abs(offset) % pool.length].id;
  };

  return drafts.map((raw, i) => {
    const d = shuffleChoices(raw);
    const up = Math.min(10, d.difficulty + 1);
    const down = Math.max(1, d.difficulty - 1);
    const nextCorrect = pick(d, up, i);
    const nextWrong = pick(d, down, i + 7);
    return { ...d, timeLimitSec: timeLimitFor(d.part, d.difficulty), nextCorrect, nextWrong };
  });
}

export const PLACEMENT_BANK: PlacementItem[] = wire(DRAFTS);

export const PLACEMENT_BY_ID: Record<string, PlacementItem> = Object.fromEntries(
  PLACEMENT_BANK.map((i) => [i.id, i]),
);

export const PLACEMENT_START: Record<AgeBand, string> = {
  child: "t03",
  teen: "t28",
  college: "t41",
  adult: "t54",
};

function assertBank(items: PlacementItem[]) {
  if (items.length < 100) throw new Error(`placement bank too small: ${items.length}`);
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) throw new Error("duplicate placement ids");
  for (const it of items) {
    if (it.nextCorrect !== "END" && !ids.has(it.nextCorrect)) {
      throw new Error(`${it.id} bad nextCorrect ${it.nextCorrect}`);
    }
    if (it.nextWrong !== "END" && !ids.has(it.nextWrong)) {
      throw new Error(`${it.id} bad nextWrong ${it.nextWrong}`);
    }
    if (it.answerIndex < 0 || it.answerIndex >= it.choices.length) {
      throw new Error(`${it.id} bad answerIndex`);
    }
    if (it.part === "part2" && it.choices.length !== 3) throw new Error(`${it.id} part2 needs 3 choices`);
    if (it.part !== "part2" && it.choices.length !== 4) throw new Error(`${it.id} needs 4 choices`);
    if (it.timeLimitSec < 40) throw new Error(`${it.id} time limit too tight`);
  }
}
assertBank(PLACEMENT_BANK);

export function getItem(id: string): PlacementItem | undefined {
  return PLACEMENT_BY_ID[id];
}

export function CEFR_FROM_DIFFICULTY(d: number): "A1" | "A2" | "B1" | "B2" | "C1" {
  if (d <= 2) return "A1";
  if (d <= 4) return "A2";
  if (d <= 6) return "B1";
  if (d <= 8) return "B2";
  return "C1";
}

export function LEVEL_BAND_LABEL(score: number): string {
  if (score < 40) return "워밍업";
  if (score < 55) return "동네 산책";
  if (score < 70) return "출퇴근";
  if (score < 85) return "야근 가능";
  return "무대 가능";
}
