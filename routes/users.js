import { hashPassword, comparePassword } from '../passwordUtils.js';
import nodemailer from 'nodemailer';
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export default async function usersRoutes(fastify, options) {
  const { supabase, verifyJWT } = options;

  // route: post /register
  // desc: crea utilisateur et envoi email verification
  fastify.post('/register', async (request, reply) => {
    const { email, password, first_name, last_name, id_role, id_club } = request.body;
    try {
      // verifier si utilisateur existe deja
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (existingUser) {
        return reply.code(400).send({ message: 'Un compte avec cet email existe deja. Veuillez vous connecter.' });
      }

      // hachage mot de passe
      const hashedPassword = await hashPassword(password);

      // generation token verification email
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      // insertion utilisateur en bdd
      const { data, error } = await supabase.from('users').insert([
        {
          email,
          password: hashedPassword,
          first_name,
          last_name,
          id_role,
          id_club,
          is_active: true,
          is_admin: false,
          email_verified: false,
          email_verification_token: verificationToken,
          email_verification_expiry: expiry,
          created_at: new Date().toISOString()
        }
      ]).select('id');

      if (error) throw error;

      // envoi email verification
      const verificationLink = `http://localhost:3000/verify-email?token=${verificationToken}`;
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "🔑 Vérifiez votre adresse e mail",
        html: `
            <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
              <div style="max-width: 600px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); margin: auto;">
                <div style="text-align: center;">
                  <img src="cid:logo" alt="logo" style="width: 80px; margin-bottom: 20px;">
                </div>
                <h2 style="color: #333; text-align: center;">Vérification de votre email</h2>
                <p style="color: #555; text-align: center;">Merci de vous etre inscrit Veuillez cliquer sur le lien pour verifier votre adresse e mail :</p>
                <p style="text-align: center;"><a href="${verificationLink}" style="color: blue; text-decoration: underline; font-size: 18px;">Verifier mon email</a></p>
                <p style="color: #555; text-align: center;">Ce lien est valable 24 heures.</p>
                <p style="text-align: center; color: #777;">Si vous n etes pas a l origine de cette inscription ignorez cet email.</p>
                <hr style="border: none; border-top: 1px solid #ddd;">
                <p style="text-align: center; color: #888;">Sécurité avant tout | NIPPON KEMPO</p>
              </div>
            </div>
          `,
        attachments: [{
          filename: 'logo.png',
          path: './assets/images/logo.png',
          cid: 'logo'
        }]
      });

      reply.send({ message: "Utilisateur cree avec succes. Vérifiez votre email pour l activer.", userId: data[0].id });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send("Erreur serveur");
    }
  });

  // route: get /verify-email
  // desc: verif token email et active utilisateur
  fastify.get('/verify-email', async (request, reply) => {
    const { token } = request.query;
    try {
      // recuperation utilisateur par token
      const { data: user, error } = await supabase
        .from('users')
        .select('id, email, email_verified, email_verification_expiry')
        .eq('email_verification_token', token)
        .single();

      if (error || !user) {
        return reply.code(400).send({ message: "Lien invalide ou expire." });
      }

      if (new Date() > new Date(user.email_verification_expiry)) {
        return reply.code(400).send({ message: "Lien expire. Veuillez vous reinscrire." });
      }

      // activation verification
      await supabase
        .from('users')
        .update({
          email_verified: true,
          email_verification_token: null,
          email_verification_expiry: null
        })
        .eq('id', user.id);

      // liaison automatique participant si trouve
      const { data: participant, error: partErr } = await supabase
        .from('participant')
        .select('id, id_user')
        .eq('email', user.email)
        .single();

      if (!partErr && participant && !participant.id_user) {
        await supabase
          .from('participant')
          .update({ id_user: user.id })
          .eq('id', participant.id);
      }

      reply.redirect("http://localhost:3000/verification-success");
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send("Erreur serveur");
    }
  });

  // route: post /resend-verification-email
  // desc: renvoi email verification
  fastify.post('/resend-verification-email', async (request, reply) => {
    const { email } = request.body;
    try {
      // recuperation utilisateur
      const { data: user, error } = await supabase
        .from('users')
        .select('id, email_verified, email_verification_token, email_verification_expiry')
        .eq('email', email)
        .single();

      if (error || !user) {
        return reply.code(404).send({ message: "Utilisateur introuvable." });
      }
      if (user.email_verified) {
        return reply.code(400).send({ message: "Email deja verifie." });
      }

      // generation nouveau token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('users')
        .update({
          email_verification_token: verificationToken,
          email_verification_expiry: expiry
        })
        .eq('id', user.id);

      // envoi email
      const verificationLink = `http://localhost:3000/verify-email?token=${verificationToken}`;
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "🔑 Vérifiez votre adresse e mail",
        html: `
                <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
                    <div style="max-width: 600px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); margin: auto;">
                        <div style="text-align: center;">
                            <img src="cid:logo" alt="logo" style="width: 80px; margin-bottom: 20px;">
                        </div>
                        <h2 style="color: #333; text-align: center;">Vérification de votre email</h2>
                        <p style="color: #555; text-align: center;">Veuillez cliquer sur le lien pour verifier votre adresse e mail :</p>
                        <p style="text-align: center;"><a href="${verificationLink}" style="color: blue; text-decoration: underline; font-size: 18px;">Verifier mon email</a></p>
                        <p style="color: #555; text-align: center;">Ce lien est valable 24 heures.</p>
                        <p style="text-align: center; color: #777;">Si vous n etes pas a l origine de cette demande ignorez cet email.</p>
                        <hr style="border: none; border-top: 1px solid #ddd;">
                        <p style="text-align: center; color: #888;">Securite avant tout | NIPPON KEMPO</p>
                    </div>
                </div>
            `,
        attachments: [{
          filename: 'logo.png',
          path: './assets/images/logo.png',
          cid: 'logo'
        }]
      });

      reply.send({ message: "Email de confirmation renvoye avec succes." });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ message: "Erreur serveur" });
    }
  });

  // route: get /verification-success
  // desc: affichage page verification reussie
  fastify.get('/verification-success', async (request, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8').send(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Verification reussie</title>
        <meta http-equiv="refresh" content="5;url=http://localhost:5173/">
        <script>
          let seconds = 5;
          function updateCountdown() {
            document.getElementById('countdown').innerText = seconds;
            if (seconds > 0) {
              seconds--;
              setTimeout(updateCountdown, 1000);
            }
          }
          window.onload = updateCountdown;
        </script>
      </head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1> Email verifie avec succes !</h1>
        <p>Redirection vers l accueil dans <span id="countdown">5</span> secondes...</p>
        <p>Si vous n etes pas redirige cliquez <a href="http://localhost:5173/">ici</a>.</p>
      </body>
    </html>
  `);
  });

  // route: post /login
  // desc: auth utilisateur et retourne jwt et participant
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;
    try {
      // recherche et verification utilisateur
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('is_active', true);

      if (error) throw error;
      if (!users.length) {
        return reply.code(401).send({ message: 'Utilisateur non trouve ou compte inactif.' });
      }

      const user = users[0];
      const match = await comparePassword(password, user.password);
      if (!match) {
        return reply.code(401).send({ message: 'Mot de passe incorrect.' });
      }

      // generation jwt
      const token = fastify.jwt.sign(user);

      // liaison auto participant si email verifie
      if (user.email_verified) {
        const { data: participantLink, error: linkErr } = await supabase
          .from('participant')
          .select('id, id_user')
          .eq('email', email)
          .single();

        if (!linkErr && participantLink && !participantLink.id_user) {
          await supabase
            .from('participant')
            .update({ id_user: user.id })
            .eq('id', participantLink.id);
        }
      }

      // recuperation fiche participant liee
      const { data: participant, error: partErr } = await supabase
        .from('participant')
        .select(`
        *,
        grade:grade(id, name),
        gender:gender(id, name)
      `)
        .eq('id_user', user.id)
        .single();

      return reply.send({
        token,
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          email_verified: user.email_verified,
          is_active: user.is_active,
          is_admin: user.is_admin,
          id_role: user.id_role
        },
        participant: partErr ? null : participant
      });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send('Erreur serveur');
    }
  });

  // route: get /users
  // desc: recup users actifs
  fastify.get('/users', { preValidation: verifyJWT }, async (request, reply) => {
    try {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, email, id_role, is_active, is_admin')
        .eq('is_active', true);
      if (error) throw error;
      reply.send(users);
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send('Erreur serveur');
    }
  });

  // route: put /users/deactivate/:id
  // desc: desactive utilisateur
  fastify.put('/users/deactivate/:id', { preValidation: verifyJWT }, async (request, reply) => {
    const { id } = request.params;
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
      reply.send({ message: 'Utilisateur desactive avec succes' });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send('Erreur serveur');
    }
  });

  // route: put /users/update-password
  // desc: reinit mdp utilisateur connecte
  fastify.put('/users/update-password', { preValidation: verifyJWT }, async (request, reply) => {
    const { id, oldPassword, newPassword } = request.body;
    try {
      if (!id || !oldPassword || !newPassword) {
        return reply.status(400).send({ message: 'Tous les champs sont requis.' });
      }
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('password')
        .eq('id', id)
        .single();
      if (userError || !user) {
        return reply.status(404).send({ message: "Utilisateur introuvable." });
      }
      const isPasswordValid = await comparePassword(oldPassword, user.password);
      if (!isPasswordValid) {
        return reply.status(401).send({ message: "L ancien mot de passe est incorrect." });
      }
      const hashedPassword = await hashPassword(newPassword);
      const { error: updateError } = await supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('id', id);
      if (updateError) throw updateError;
      return reply.send({ message: 'Mot de passe mis a jour avec succes.' });
    } catch (err) {
      fastify.log.error(err);
      if (err.code === '22P02') {
        return reply.status(400).send({ message: "Donnees invalides envoyees." });
      }
      return reply.status(500).send({ message: 'Erreur serveur veuillez reessayer plus tard.' });
    }
  });

  // route: put /users/update-password-without-jwt
  // desc: reinit mdp sans jwt
  fastify.put('/users/update-password-without-jwt', async (request, reply) => {
    const { email, newPassword, code } = request.body;
    try {
      if (!email || !newPassword || !code) {
        return reply.code(400).send({ message: "Requete invalide Tous les champs sont requis." });
      }
      const { data: user, error } = await supabase
        .from('users')
        .select('id, reset_token, reset_token_expiry')
        .eq('email', email)
        .single();
      if (error || !user || !user.reset_token) {
        return reply.code(400).send({ message: "Reinitialisation du mot de passe non valide ou expiree." });
      }
      const expiryDate = new Date(user.reset_token_expiry + "Z");
      const nowUTC = new Date();
      if (nowUTC > expiryDate) {
        return reply.code(400).send({ message: "Code expire." });
      }
      const decryptedCode = CryptoJS.AES.decrypt(user.reset_token, process.env.JWT_SECRET).toString(CryptoJS.enc.Utf8);
      if (decryptedCode !== code) {
        return reply.code(400).send({ message: "Code invalide." });
      }
      const hashedPassword = await hashPassword(newPassword);
      const { error: updateError } = await supabase
        .from('users')
        .update({ password: hashedPassword, reset_token: null, reset_token_expiry: null })
        .eq('id', user.id);
      if (updateError) throw updateError;
      reply.send({ message: "Mot de passe mis a jour avec succes" });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ message: "Erreur serveur" });
    }
  });

  // route: post /forgot-password
  // desc: crea code temporaire mdp et envoi email
  fastify.post('/forgot-password', async (request, reply) => {
    const { email } = request.body;
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();
      if (error || !user) {
        return reply.code(404).send({ message: "Utilisateur non trouve avec cette adresse email." });
      }
      const generateCode = () => {
        const chars = 'ABCDEFGHJKMNOPQRSTUVWXYZabcdefghjkmnopqrstuvwxyz0123456789!@#$%^&*';
        return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      };
      const resetCode = generateCode();
      const encryptedCode = CryptoJS.AES.encrypt(resetCode, process.env.JWT_SECRET).toString();
      const { data: nowData, error: nowError } = await supabase.rpc('now');
      if (nowError) throw nowError;
      const expiry = new Date(Date.now() + 10 * 60000);
      const expiryUTC = new Date(expiry.toISOString());
      await supabase.from('users').update({
        reset_token: encryptedCode,
        reset_token_expiry: expiryUTC.toISOString()
      }).eq('id', user.id);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: '🔑 Code de connexion temporaire NK',
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
            <div style="max-width: 600px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); margin: auto;">
              <div style="text-align: center;">
                <img src="cid:logo" alt="logo" style="width: 80px; margin-bottom: 20px;">
              </div>
              <h2 style="color: #333; text-align: center;">Code de connexion temporaire</h2>
              <p style="color: #555; text-align: center;">Vous avez demande un code de connexion temporaire</p>
              <p style="color: #555; text-align: center;">Utilisez ce code pour poursuivre :</p>
              <div style="text-align: center; font-size: 24px; font-weight: bold; background: #eee; padding: 10px; border-radius: 5px;">
                ${resetCode}
              </div>
              <p style="color: #555; text-align: center; margin-top: 20px;">Ce code est valable 10 minutes Ne le partagez pas.</p>
              <p style="text-align: center; color: #777;">Si vous n etes pas a l origine de cette demande ignorez cet email.</p>
              <hr style="border: none; border-top: 1px solid #ddd;">
              <p style="text-align: center; color: #888;">Securite avant tout | NIPPON KEMPO</p>
            </div>
          </div>
        `,
        attachments: [{
          filename: 'logo.png',
          path: './assets/images/logo.png',
          cid: 'logo'
        }]
      });
      reply.send({ message: "Code envoye par email", encryptedCode });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send("Erreur serveur");
    }
  });

  // route: post /verify-reset-code
  // desc: verif code temporaire mdp
  fastify.post('/verify-reset-code', async (request, reply) => {
    const { email, code } = request.body;
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('id, reset_token, reset_token_expiry')
        .eq('email', email)
        .single();
      if (error || !user) {
        return reply.code(400).send({ userId: -1, message: "Utilisateur non trouve" });
      }
      const expiryDate = new Date(user.reset_token_expiry + "Z");
      const nowUTC = new Date();
      if (nowUTC > expiryDate) {
        return reply.code(400).send({ userId: -1, message: "Code expire." });
      }
      const decryptedCode = CryptoJS.AES.decrypt(user.reset_token, process.env.JWT_SECRET).toString(CryptoJS.enc.Utf8);
      if (decryptedCode !== code) {
        return reply.code(400).send({ userId: -1, message: "Code invalide." });
      }
      reply.send({ userId: user.id, message: "Code valide." });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ userId: -1, message: "Erreur serveur" });
    }
  });


  // recup tous les sous-gestionnaires d’un club
  fastify.get('/clubs/:clubId/assistant-managers', { preValidation: verifyJWT }, async (request, reply) => {
    const clubId = Number(request.params.clubId);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('id_role', 2)
        .eq('id_club', clubId)
        .eq('is_active', true);
      if (error) throw error;
      reply.send(data);
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ message: 'Erreur serveur' });
    }
  });

  // creer un sous-gestionnaire pour un club
  fastify.post('/clubs/:clubId/assistant-managers', { preValidation: verifyJWT }, async (request, reply) => {
    const clubId = Number(request.params.clubId);
    const { first_name, last_name, email, password } = request.body;
    try {
      // hacher le mot de passe
      const hashed = await hashPassword(password);

      // insertion
      const { data, error } = await supabase
        .from('users')
        .insert([{
          first_name, last_name, email,
          password: hashed,
          id_role: 2,
          id_club: clubId,
          is_active: true,
          is_admin: false,
          email_verified: true,  // on skip l'email verification ici
          created_at: new Date().toISOString()
        }])
        .select('id, first_name, last_name, email');
      if (error) throw error;
      reply.code(201).send(data[0]);
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ message: 'Erreur serveur' });
    }
  });

  // supp (désactiver) un sous-gestionnaire
  fastify.delete('/clubs/:clubId/assistant-managers/:id', { preValidation: verifyJWT }, async (request, reply) => {
    const clubId = Number(request.params.clubId);
    const userId = Number(request.params.id);
    try {
      // on verif que c'est bien un assistant du club
      const { data: u, error: selErr } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .eq('id_role', 2)
        .eq('id_club', clubId)
        .single();
      if (selErr || !u) {
        return reply.code(404).send({ message: 'Sous-gestionnaire introuvable' });
      }
      // on désactive le compte
      const { error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', userId);
      if (error) throw error;
      reply.send({ message: 'Sous-gestionnaire supprimé' });
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ message: 'Erreur serveur' });
    }
  });

}
