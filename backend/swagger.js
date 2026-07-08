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
        url: "http://localhost:5000",
        description: "Development server",
      },
    ],
  },
  apis: ["./server.js"], // Path to the file with JSDoc comments
};

export default swaggerJsdoc(options);