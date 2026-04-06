const API_KEY = "AIzaSyDj2CUdvC3QGbKUGVrwyz4mbpZglNVJswk"; // 👈 여기에 실제 API 키를 넣고 저장하세요!

async function checkModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const data = await response.json();
    
    console.log("=== generateContent가 지원되는 모델 목록 ===");
    data.models.forEach(model => {
      if (model.supportedGenerationMethods.includes("generateContent")) {
        console.log(model.name.replace('models/', ''));
      }
    });
  } catch (error) {
    console.error("조회 실패:", error);
  }
}

checkModels();