// Guided interview prompts, first cut of the plan's "100–200 prompts across
// life domains" (MVP features, §3), in the archive's three languages.
// Ordered gently: easy warm memories first, reflective questions later.

export type PromptLanguage = "en" | "ru" | "he";

export interface InterviewPrompt {
  domain: string;
  question: Record<PromptLanguage, string>;
}

export const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Русский" },
  { value: "he", label: "עברית" },
  { value: "en", label: "English" },
  { value: "mixed", label: "Смешанный · מעורב · Mixed" },
] as const;

export const INTERVIEW_PROMPTS: InterviewPrompt[] = [
  { domain: "Childhood", question: {
    en: "What is your earliest memory?",
    ru: "Какое ваше самое раннее воспоминание?",
    he: "מהו הזיכרון המוקדם ביותר שלך?" } },
  { domain: "Childhood", question: {
    en: "Describe the home you grew up in — the rooms, the sounds, the smells.",
    ru: "Опишите дом, в котором вы выросли — комнаты, звуки, запахи.",
    he: "תארי את הבית שבו גדלת — החדרים, הקולות, הריחות." } },
  { domain: "Childhood", question: {
    en: "What did you love doing as a child that nobody had to ask you twice to do?",
    ru: "Что вы в детстве любили делать так, что вас не нужно было просить дважды?",
    he: "מה אהבת לעשות בילדות שאף אחד לא היה צריך לבקש ממך פעמיים?" } },
  { domain: "Family origins", question: {
    en: "Tell me about your parents — what were they like when you were small?",
    ru: "Расскажите о родителях — какими они были, когда вы были маленькими?",
    he: "ספרי לי על ההורים שלך — איך הם היו כשהיית קטנה?" } },
  { domain: "Family origins", question: {
    en: "What do you know about how your parents or grandparents came to live where they did?",
    ru: "Что вы знаете о том, как ваши родители или бабушки и дедушки оказались там, где жили?",
    he: "מה את יודעת על איך ההורים או הסבים שלך הגיעו לגור איפה שגרו?" } },
  { domain: "Family origins", question: {
    en: "Which relative do people say you take after, and why?",
    ru: "На кого из родных, как говорят, вы похожи — и чем?",
    he: "על מי מהמשפחה אומרים שאת דומה, ולמה?" } },
  { domain: "Places", question: {
    en: "Describe a street, town, or landscape that still feels like yours.",
    ru: "Опишите улицу, город или пейзаж, которые до сих пор кажутся вам своими.",
    he: "תארי רחוב, עיר או נוף שעד היום מרגישים שלך." } },
  { domain: "Places", question: {
    en: "Tell me about a journey or move that changed the direction of your life.",
    ru: "Расскажите о поездке или переезде, которые изменили вашу жизнь.",
    he: "ספרי לי על מסע או מעבר ששינו את כיוון החיים שלך." } },
  { domain: "Love", question: {
    en: "How did you meet your partner, and what did you first notice about them?",
    ru: "Как вы познакомились со своим спутником жизни, и что вы заметили в нём первым делом?",
    he: "איך הכרת את בן הזוג שלך, ומה שמת לב אליו קודם?" } },
  { domain: "Love", question: {
    en: "What made you decide this was the person? Tell it as it happened.",
    ru: "Как вы поняли, что это тот самый человек? Расскажите, как это было.",
    he: "מה גרם לך להחליט שזה האדם הנכון? ספרי איך זה קרה." } },
  { domain: "Work", question: {
    en: "What work did you do, and how did you come to it?",
    ru: "Кем вы работали, и как вы пришли к этому делу?",
    he: "במה עבדת, ואיך הגעת לזה?" } },
  { domain: "Work", question: {
    en: "Tell me about something you made or did at work that you're still proud of.",
    ru: "Расскажите о том, что вы сделали в работе, чем гордитесь до сих пор.",
    he: "ספרי לי על משהו שעשית בעבודה שאת עדיין גאה בו." } },
  { domain: "Work", question: {
    en: "Who taught you your craft, and what was the most important lesson?",
    ru: "Кто научил вас вашему ремеслу, и какой урок был самым важным?",
    he: "מי לימד אותך את המקצוע, ומה היה השיעור החשוב ביותר?" } },
  { domain: "Traditions", question: {
    en: "Walk me through a holiday or family meal exactly as your family did it.",
    ru: "Опишите праздник или семейный ужин ровно так, как это было принято у вас.",
    he: "תארי לי חג או ארוחה משפחתית בדיוק כמו שהיה אצלכם." } },
  { domain: "Traditions", question: {
    en: "Is there a recipe, song, or ritual you hope never gets lost? Tell its story.",
    ru: "Есть ли рецепт, песня или обычай, который вы не хотите потерять? Расскажите его историю.",
    he: "יש מתכון, שיר או מנהג שאת מקווה שלא יאבד? ספרי את הסיפור שלו." } },
  { domain: "Friendship", question: {
    en: "Tell me about a friend who mattered — how you met, and what you went through together.",
    ru: "Расскажите о важном для вас друге — как вы познакомились и что пережили вместе.",
    he: "ספרי לי על חבר או חברה שהיו חשובים — איך נפגשתם ומה עברתם יחד." } },
  { domain: "Hard times", question: {
    en: "Tell me about a time that truly tested you. What carried you through?",
    ru: "Расскажите о времени, которое стало для вас настоящим испытанием. Что помогло вам выстоять?",
    he: "ספרי לי על תקופה שבאמת בחנה אותך. מה עזר לך לעבור אותה?" } },
  { domain: "Hard times", question: {
    en: "What loss shaped you the most, and what would you want us to know about that person or time?",
    ru: "Какая утрата повлияла на вас сильнее всего, и что вы хотели бы, чтобы мы знали о том человеке или времени?",
    he: "איזה אובדן עיצב אותך יותר מכול, ומה היית רוצה שנדע על האדם או התקופה ההיא?" } },
  { domain: "Joys", question: {
    en: "Describe a perfectly ordinary day from a happy period of your life.",
    ru: "Опишите самый обычный день из счастливого периода вашей жизни.",
    he: "תארי יום רגיל לגמרי מתקופה מאושרת בחייך." } },
  { domain: "Joys", question: {
    en: "What always makes you laugh, even now?",
    ru: "Что всегда вас смешит, даже сейчас?",
    he: "מה תמיד מצחיק אותך, גם עכשיו?" } },
  { domain: "Values", question: {
    en: "What advice do you find yourself repeating to the people you love?",
    ru: "Какой совет вы чаще всего повторяете своим близким?",
    he: "איזו עצה את מוצאת את עצמך חוזרת עליה לאנשים שאת אוהבת?" } },
  { domain: "Values", question: {
    en: "What do you believe that you didn't believe at twenty?",
    ru: "Во что вы верите сейчас, во что не верили в двадцать лет?",
    he: "במה את מאמינה היום שלא האמנת בו בגיל עשרים?" } },
  { domain: "Legacy", question: {
    en: "What do you hope people will say about you when you're not in the room?",
    ru: "Что, как вы надеетесь, люди говорят о вас, когда вас нет рядом?",
    he: "מה את מקווה שאנשים יגידו עלייך כשאת לא בחדר?" } },
  { domain: "Legacy", question: {
    en: "If a great-grandchild you never meet listens to this one day — what do you want to tell them?",
    ru: "Если однажды это услышит правнук, которого вы никогда не увидите, — что вы хотите ему сказать?",
    he: "אם נין או נינה שלא תפגשי יקשיבו לזה יום אחד — מה את רוצה להגיד להם?" } },
];
