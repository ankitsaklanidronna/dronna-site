export const SAMPLE_QUESTIONS = [
  { id:"q1", question_text:"In which year was Uttarakhand established as a state?", option_a:"2000", option_b:"2001", option_c:"1999", option_d:"2002", correct_answer:"A", subject:"General Knowledge", topic:"Uttarakhand", difficulty:"easy", exam_type:"UKPSC" },
  { id:"q2", question_text:"What is the capital of Uttarakhand?", option_a:"Nainital", option_b:"Dehradun", option_c:"Haridwar", option_d:"Rishikesh", correct_answer:"B", subject:"General Knowledge", topic:"Uttarakhand", difficulty:"easy", exam_type:"UKPSC" },
  { id:"q3", question_text:"Gangotri Glacier is located in which district?", option_a:"Chamoli", option_b:"Rudraprayag", option_c:"Uttarkashi", option_d:"Pithoragarh", correct_answer:"C", subject:"Geography", topic:"Uttarakhand Geography", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q4", question_text:"The Valley of Flowers is located in which district?", option_a:"Chamoli", option_b:"Uttarkashi", option_c:"Bageshwar", option_d:"Almora", correct_answer:"A", subject:"Geography", topic:"Uttarakhand Geography", difficulty:"easy", exam_type:"UKSSSC" },
  { id:"q5", question_text:"Under which article of the Indian Constitution is a national emergency declared?", option_a:"Article 352", option_b:"Article 356", option_c:"Article 360", option_d:"Article 370", correct_answer:"A", subject:"Polity", topic:"Constitution", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q6", question_text:"Jim Corbett National Park is located in which district?", option_a:"Nainital", option_b:"Almora", option_c:"Pauri Garhwal", option_d:"Haridwar", correct_answer:"A", subject:"General Knowledge", topic:"National Parks", difficulty:"easy", exam_type:"UKSSSC" },
  { id:"q7", question_text:"What is the state bird of Uttarakhand?", option_a:"Peacock", option_b:"Monal", option_c:"Bulbul", option_d:"Partridge", correct_answer:"B", subject:"General Knowledge", topic:"Uttarakhand", difficulty:"easy", exam_type:"UKSSSC" },
  { id:"q8", question_text:"Kedarnath Temple is situated on the bank of which river?", option_a:"Alaknanda", option_b:"Bhagirathi", option_c:"Mandakini", option_d:"Saraswati", correct_answer:"C", subject:"General Knowledge", topic:"Religious Places", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q9", question_text:"In which year did the Panchayati Raj system begin in India?", option_a:"1959", option_b:"1952", option_c:"1962", option_d:"1956", correct_answer:"A", subject:"Polity", topic:"Panchayati Raj", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q10", question_text:"Which is the largest district of Uttarakhand by area?", option_a:"Pithoragarh", option_b:"Chamoli", option_c:"Uttarkashi", option_d:"Pauri Garhwal", correct_answer:"B", subject:"Geography", topic:"Uttarakhand Geography", difficulty:"hard", exam_type:"UKPSC" },
];

export const SAMPLE_SETS = [
  { id:"s1", set_name:"UKPSC General Knowledge Set 1", subject:"General Knowledge", exam_type:"UKPSC", time_limit_minutes:20, is_paid:false, price:0, question_ids:["q1","q2","q6","q7","q8","q10"] },
  { id:"s2", set_name:"Uttarakhand Geography Practice Set", subject:"Geography", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, price:0, question_ids:["q3","q4","q10"] },
  { id:"s3", set_name:"UKSSSC 10 Full Paper Set", subject:"Mixed", exam_type:"UKSSSC", time_limit_minutes:120, is_paid:true, price:99,
    description:"10 complete UKSSSC papers based on previous year papers for Group C, VDO, and Forest Guard",
    highlights:["100 Questions per Paper","Previous Year Pattern","General Knowledge + Hindi + Science + Mathematics"],
    question_ids:["q1","q2","q3","q4","q6","q7","q8","q9","q10"] },
  { id:"s4", set_name:"UKPSC 10 Full Paper Set", subject:"Mixed", exam_type:"UKPSC", time_limit_minutes:120, is_paid:true, price:99,
    description:"10 complete UKPSC papers based on previous year papers for LT Grade, PCS, and Lecturer",
    highlights:["100 Questions per Paper","Previous Year Pattern","General Studies + Polity + Uttarakhand Special"],
    question_ids:["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10"] },
];

export const DEMO_SETS = SAMPLE_SETS
  .filter((set) => !set.is_paid)
  .map((set) => ({
    ...set,
    id: `demo-${set.id}`,
    is_paid: false,
    price: 0,
    question_count: set.question_ids?.length || 0,
    demo: true,
  }));

export function isDemoSetId(setId = "") {
  return String(setId).startsWith("demo-");
}

export function getDemoSet(setId = "") {
  return DEMO_SETS.find((set) => set.id === setId) || null;
}

export function getDemoQuestionsForSet(set = {}) {
  const ids = Array.isArray(set.question_ids) ? set.question_ids : [];
  return ids
    .map((questionId) => SAMPLE_QUESTIONS.find((question) => question.id === questionId))
    .filter(Boolean);
}
