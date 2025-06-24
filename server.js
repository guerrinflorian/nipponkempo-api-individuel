import Fastify from "fastify";
import { createClient } from "@supabase/supabase-js";
import { hashPassword, comparePassword } from "./passwordUtils.js";
import FastifyJwt from "@fastify/jwt";
import FastifyCors from "@fastify/cors";
import user from "./routes/users.js";
import adminUsers from "./routes/adminUsers.js";
import club from "./routes/clubs.js";
import { supabaseUrl, supabaseAnonKey, jwtSecret } from "./config.js";
import tournamentStatus from "./routes/tournamentStatus.js";
import tournament from "./routes/tournament.js";
import category from "./routes/category.js";
import participants from "./routes/participants.js";
import tournamentComments from "./routes/tournamentComments.js";
import { dirname, join } from "path";

// init de Fastify
const fastify = Fastify({ logger: true });

// config JWT & CORS
fastify.register(FastifyJwt, {
  secret: jwtSecret,
  sign: {
    expiresIn: "4h", // le token expire 2 heures apres sa création
  },
});

// enregistrer le plugin static
fastify.register(import("@fastify/static"), {
  root: join(__dirname, "public"),
  prefix: "/",
});

fastify.register(FastifyCors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// connexion à Supabase
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// routes avec Supabase
fastify.register(club, { supabase, verifyJWT });
fastify.register(tournament, { supabase, verifyJWT });
fastify.register(category, { supabase, verifyJWT });
fastify.register(tournamentStatus, { supabase, verifyJWT });
fastify.register(participants, { supabase, verifyJWT });
fastify.register(user, { supabase, hashPassword, comparePassword, verifyJWT });
fastify.register(adminUsers, {
  supabase,
  hashPassword,
  comparePassword,
  verifyJWT,
});
fastify.register(tournamentComments, { supabase, verifyJWT });

async function verifyJWT(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
}

// laancer le serveur
//const start = async () => {
//  try {
//    await fastify.listen({ port: 3000, host: '0.0.0.0' });
//   fastify.log.info(`🚀 Serveur lancé`);
// } catch (err) {
//   fastify.log.error(err);
//    process.exit(1);
// }
//};

//start();

// route de base pour tester
fastify.get("/", async (request, reply) => {
  return {
    message: "API Fastify déployée avec succès !",
    status: "running",
    timestamp: new Date().toISOString(),
  };
});

// route health check
fastify.get("/health", async (request, reply) => {
  return { status: "ok", uptime: process.uptime() };
});

export default async function handler(req, res) {
  await fastify.ready();
  fastify.server.emit("request", req, res);
}
