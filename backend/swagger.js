// swagger.js
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "YouTube Data Tool API",
      version: "1.0.0",
      description: "Backend for extracting YouTube data via the official API.",
    },
    servers: [
      {
        url: process.env.NODE_ENV === "production" 
          ? "https://yt-data-extraction-web.onrender.com"
          : "http://localhost:5000",
        description: process.env.NODE_ENV === "production" 
          ? "Production server" 
          : "Development server",
      },
    ],
  },
  apis: ["./server.js"],
};

export default swaggerJsdoc(options);