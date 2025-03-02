import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getCompletion() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content:
            "Determine the time frames of when the carbon footprint is the least present",
        },
      ],
    });

    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.error("Error:", error);
  }
}

getCompletion();
