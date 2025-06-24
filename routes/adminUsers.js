import { hashPassword, comparePassword } from '../passwordUtils.js';
import nodemailer from 'nodemailer';
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export default async function adminUsers(fastify, options) {
  const { supabase, verifyJWT } = options;

  // route: post /admin/login
  // desc: connexion d un administrateur
  fastify.post('/admin/login', async (request, reply) => {
    const { email, password } = request.body

    try {
      // 1. on cherche l admin actif
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .or('is_admin.eq.true,id_role.in.(1,2)')
        .ilike('email', email)
        .eq('is_active', true)

      if (usersError) throw usersError
      if (!users?.length) {
        return reply.code(401).send({ message: 'Administrateur non trouvé ou compte inactif.' })
      }

      const admin = users[0]

      // 2. verif du mot de passe
      const match = await comparePassword(password, admin.password)
      if (!match) {
        return reply.code(401).send({ message: 'Mot de passe incorrect.' })
      }

      // 3. on recup d abord les permission_id associes au role
      const { data: rpRows, error: rpError } = await supabase
        .from('role_permissions')
        .select('permission_id')
        .eq('role_id', admin.id_role)

      if (rpError) {
        fastify.log.error('Erreur role_permissions:', rpError)
      }
      const permIds = (rpRows || []).map(r => r.permission_id)

      // 4. puis on recup les noms dans la table permissions
      let perms = []
      if (permIds.length) {
        const { data: permRows, error: permError } = await supabase
          .from('permissions')
          .select('name')
          .in('id', permIds)

        if (permError) {
          fastify.log.error('Erreur permissions:', permError)
        } else {
          perms = (permRows || []).map(p => p.name)
        }
      }

      // 5. on signe le jwt et renvoi l utilisateur et ses permissions
      const token = fastify.jwt.sign({
        id:       admin.id,
        id_club:  admin.id_club,
        id_role:  admin.id_role,
        is_admin: admin.is_admin,
      })

      return {
        token,
        id:         admin.id,
        first_name: admin.first_name,
        last_name:  admin.last_name,
        email:      admin.email,
        is_active:  admin.is_active,
        is_admin:   admin.is_admin,
        id_role:    admin.id_role,
        id_club:    admin.id_club,
        permissions: perms
      }
    } catch (err) {
      fastify.log.error(err)
      reply.code(500).send({ message: 'Erreur serveur.' })
    }
  })

  // route: post /admin/register
  // desc: crea d un administrateur
  fastify.post('/admin/register', { preValidation: verifyJWT }, async (request, reply) => {
    const { email, password, first_name, last_name, id_role } = request.body;

    try {
      // verif si l admin existe deja
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .or('is_admin.eq.true,id_role.in.(1,2)')
        .ilike('email', email)
        .single();

      if (existingUser) {
        return reply.code(400).send({ message: 'Un administrateur avec cet email existe déjà.' });
      }

      // hachage du mot de passe
      const hashedPassword = await hashPassword(password);

      // crea de l administrateur
      const { data, error } = await supabase.from('users').insert([
        {
          email,
          password: hashedPassword,
          first_name,
          last_name,
          is_active: true,
          is_admin: true,
          id_role,
          created_at: new Date().toISOString()
        }
      ]).select('id');

      if (error) throw error;

      reply.send({ message: "Administrateur créé avec succès.", adminId: data[0].id });

    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send("Erreur serveur");
    }
  });

  // route: get /admin/me
  // desc: verif du token et renvoi des infos user
  fastify.get(
    '/admin/me',
    { preValidation: verifyJWT },
    async (request, reply) => {
      try {
        // 1. recup id depuis le jwt deja verifie
        const { id } = request.user

        // 2. charge l utilisateur et verif qu il est actif
        const { data: user, error: userErr } = await supabase
          .from('users')
          .select('id, first_name, last_name, email, is_active, is_admin, id_role, id_club')
          .eq('id', id)
          .single()

        if (userErr) throw userErr
        if (!user || !user.is_active) {
          return reply.code(401).send({ message: 'Utilisateur inactif ou non trouvé.' })
        }

        // 3. recup permission_id du role
        const { data: rpRows, error: rpErr } = await supabase
          .from('role_permissions')
          .select('permission_id')
          .eq('role_id', user.id_role)

        if (rpErr) {
          fastify.log.error('Erreur role_permissions /me:', rpErr)
        }
        const permIds = (rpRows || []).map(r => r.permission_id)

        // 4. charge les noms depuis la table permissions
        let perms = []
        if (permIds.length) {
          const { data: permRows, error: permErr } = await supabase
            .from('permissions')
            .select('name')
            .in('id', permIds)

          if (permErr) {
            fastify.log.error('Erreur permissions /me:', permErr)
          } else {
            perms = (permRows || []).map(p => p.name)
          }
        }

        // 5. renvoi objet user token et permissions
        const token = request.headers.authorization.split(' ')[1]
        return {
          token,
          id:         user.id,
          first_name: user.first_name,
          last_name:  user.last_name,
          email:      user.email,
          is_active:  user.is_active,
          is_admin:   user.is_admin,
          id_role:    user.id_role,
          id_club:    user.id_club,
          permissions: perms
        }
      } catch (err) {
        fastify.log.error(err)
        reply.code(401).send({ message: 'Token invalide ou expiré.' })
      }
    }
  );

}
