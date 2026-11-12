// The two questions and their options. The answer key lives in answers.js,
// which phones only load once the presenter has revealed an answer.
window.POLL = {
  title: "Keratoconus in the Middle East and North Africa",
  short: "Keratoconus · MENA",
  questions: [
    {
      id: "q1",
      tag: "General population",
      text: "In the general population of the Middle East and North Africa, how common is clinically manifest keratoconus?",
      options: [
        { id: "A", main: "1 in 2,000", sub: "0.05%" },
        { id: "B", main: "1 in 350", sub: "0.3%" },
        { id: "C", main: "1 in 150", sub: "0.7%" },
        { id: "D", main: "1 in 40", sub: "2.5%" },
        { id: "E", main: "1 in 25", sub: "4%" }
      ]
    },
    {
      id: "q2",
      tag: "Refractive-surgery candidates",
      text: "Among people screened for refractive surgery (LASIK or PRK) in the region, how common is clinically manifest keratoconus?",
      options: [
        { id: "A", main: "1 in 800", sub: "0.1%" },
        { id: "B", main: "1 in 100", sub: "1%" },
        { id: "C", main: "1 in 25", sub: "4%" },
        { id: "D", main: "1 in 13", sub: "8%" },
        { id: "E", main: "1 in 5", sub: "20%" }
      ]
    }
  ]
};
