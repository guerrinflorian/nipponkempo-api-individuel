import FastifyMultipart from '@fastify/multipart'
import path from 'path'

export default async function club(fastify, options) {
  const { supabase, verifyJWT } = options

  fastify.register(FastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
    attachFieldsToBody: true
  })

  // route: get /clubs
  // desc: recup tous les clubs
  fastify.get('/clubs', async (request, reply) => {
    try {
      // on récupère les clubs, leur manager, leurs tournois (avec statut), 
      // leurs commentaires (juste l'id), et leurs catégories
      const { data: clubs, error } = await supabase
        .from('club')
        .select(`
          *,
          manager:users(
            id,
            email
          ),
          tournament(
            *,
            tournament_status(name, color),
            comments:comments(id),
            category(
              *,
              id_winner,
              winner:participant!fk_category_winner(
                id,
                first_name,
                last_name
              ),
              category_type(name),
              tournament_status(id, name, color),
              grade_minimum:id_grade_minimum(name),
              grade_maximum:id_grade_maximum(name),
              gender(name),
              category_ages:category_category_age(
                category_age:category_age_id(
                  name,
                  min_age,
                  max_age
                )
              )
            )
          )
        `)
        .eq('manager.id_role', 1)

      if (error) throw error

      // pour chaque tournoi on calcule le nombre de commentaires
      const enriched = clubs.map(club => ({
        ...club,
        tournament: club.tournament.map(t => ({
          ...t,
          comment_count: Array.isArray(t.comments) ? t.comments.length : 0
        }))
      }))

      return reply.send(enriched)
    } catch (err) {
      fastify.log.error(err)
      return reply.status(500).send('Erreur serveur')
    }
  })


  // route: get /clubs/:id
  // desc: recup un club et filtre images existantes
  fastify.get('/clubs/:id', async (request, reply) => {
    try {
      const { id } = request.params

      const { data: club, error } = await supabase
        .from('club')
        .select(`
          *,
          tournament(
            *,
            tournament_status(name, color),
            category(
              *,
              category_type(name),
              grade_minimum: id_grade_minimum(name),
              grade_maximum: id_grade_maximum(name),
              gender(name)
            )
          )
        `)
        .eq('id', id)
        .single()
      if (error) throw error

      const folder = `${id}/images`
      const { data: files, error: listErr } = await supabase
        .storage
        .from('club-images')
        .list(folder)
      if (!listErr && files) {
        for (const key of ['image_1', 'image_2', 'image_3']) {
          const f = files.find(f => f.name.startsWith(key))
          if (!f) {
            club[key] = null
          } else {
            const { data: urlData, error: urlErr } = await supabase
              .storage
              .from('club-images')
              .getPublicUrl(`${folder}/${f.name}`)
            club[key] = urlErr ? null : urlData.publicUrl
          }
        }
      }

      reply.send(club)
    } catch (err) {
      fastify.log.error(err)
      reply.status(500).send('Erreur serveur')
    }
  })

  // route: put /clubs/:id
  // desc: modifs texte upload et suppr images
  fastify.put(
    '/clubs/:id',
    { preValidation: verifyJWT, bodyLimit: 10 * 1024 * 1024 },
    async (request, reply) => {
      try {
        const { id } = request.params

        if (!request.isMultipart()) {
          return reply.code(400).send({ error: 'Content-Type must be multipart/form-data' })
        }

        // 1) mise a jour texte
        const { name, address, description } = request.body
        if (!name?.value || !address?.value || !description?.value) {
          return reply.code(400).send({ error: 'Missing required fields' })
        }
        const { error: txtErr } = await supabase
          .from('club')
          .update({
            name: name.value,
            address: address.value,
            description: description.value
          })
          .eq('id', id)
        if (txtErr) throw txtErr

        // 2) liste des fichiers existants
        const folder = `${id}/images`
        const { data: files, error: listErr } = await supabase
          .storage
          .from('club-images')
          .list(folder)
        if (listErr) {
          fastify.log.warn(`Impossible de lister les images pour suppression :`, listErr)
        }

        // 3) traitement images
        const imageKeys = ['image_1', 'image_2', 'image_3']
        const updates = {}

        for (const key of imageKeys) {
          const part = request.body[key]
          const del = request.body[`delete_${key}`]

          if (del?.value === '1' && files) {
            const f = files.find(f => f.name.startsWith(key))
            if (f) {
              const { error: rmErr } = await supabase.storage
                .from('club-images')
                .remove([`${folder}/${f.name}`])
              if (rmErr) throw rmErr
            }
            updates[key] = null
          }
          else if (part?.file) {
            const buffer = await part.toBuffer()
            const ext = path.extname(part.filename) || `.${part.mimetype.split('/')[1]}`
            const fileName = `${key}${ext}`
            const storagePath = `${folder}/${fileName}`

            const { error: upErr } = await supabase.storage
              .from('club-images')
              .upload(storagePath, buffer, {
                contentType: part.mimetype,
                upsert: true,
                cacheControl: '3600'
              })
            if (upErr) throw upErr

            const { data: urlData, error: urlErr } = supabase.storage
              .from('club-images')
              .getPublicUrl(storagePath)
            if (urlErr) throw urlErr
            updates[key] = urlData.publicUrl
          }
        }

        // 4) applique maj images en bdd
        if (Object.keys(updates).length) {
          const { error: imgErr } = await supabase
            .from('club')
            .update(updates)
            .eq('id', id)
          if (imgErr) throw imgErr
        }

        // 5) renvoie club mis a jour
        const { data: updatedClub, error: finalErr } = await supabase
          .from('club')
          .select('*')
          .eq('id', id)
          .single()
        if (finalErr) throw finalErr

        reply.send(updatedClub)
      } catch (err) {
        fastify.log.error(err)
        request.code(500).send({ error: 'Update failed', details: err.message })
      }
    }
  );

  // creation de club
  fastify.post(
    '/clubs',
    {
      preValidation: verifyJWT, schema: {
        body: {
          type: 'object',
          required: ['name', 'address', 'description'],
          properties: {
            name: { type: 'string', minLength: 1 },
            address: { type: 'string', minLength: 1 },
            description: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      const { name, address, description } = request.body
      try {
        const now = new Date().toISOString()
        const { data, error } = await supabase
          .from('club')
          .insert([{
            name,
            address,
            description,
            is_active: true
          }])
          .select('id, name, address, description, is_active')

        if (error) throw error
        // renvoie le club créé
        reply.code(201).send(data[0])
      } catch (err) {
        fastify.log.error(err)
        reply.status(500).send({ message: 'Erreur serveur lors de la création du club' })
      }
    }
  );

  // suppression de club et de ses dépendances
  fastify.delete('/clubs/:id', { preValidation: verifyJWT }, async (request, reply) => {
    const clubId = Number(request.params.id)

    try {
      // 1) Délier tout utilisateur lié à ce club
      const { error: unlinkErr } = await supabase
        .from('users')
        .update({ id_club: null })
        .eq('id_club', clubId)
      if (unlinkErr) throw unlinkErr

      // 2) Récupérer tous les IDs de tournois du club
      const { data: tournaments, error: tErr } = await supabase
        .from('tournament')
        .select('id')
        .eq('id_club', clubId)
      if (tErr) throw tErr
      const tournamentIds = tournaments.map(t => t.id)

      // 3) Récupérer toutes les catégories liées à ces tournois
      const { data: categories, error: cErr } = await supabase
        .from('category')
        .select('id')
        .in('id_tournament', tournamentIds)
      if (cErr) throw cErr
      const categoryIds = categories.map(c => c.id)

      // 4) Récupérer tous les pools de ces catégories
      const { data: pools, error: pErr } = await supabase
        .from('pool')
        .select('id')
        .in('category_id', categoryIds)
      if (pErr) throw pErr
      const poolIds = pools.map(p => p.id)

      // 5) Supprimer les classements de pools
      const { error: rankErr } = await supabase
        .from('pool_ranking')
        .delete()
        .in('pool_id', poolIds)
      if (rankErr) throw rankErr

      // 6) Supprimer les matchs de ces pools
      const { error: matchErr } = await supabase
        .from('match')
        .delete()
        .in('id_pool', poolIds)
      if (matchErr) throw matchErr

      // 7) Supprimer les pools
      const { error: poolErr } = await supabase
        .from('pool')
        .delete()
        .in('id', poolIds)
      if (poolErr) throw poolErr

      // 8) Supprimer les rounds liés aux catégories
      const { error: roundErr } = await supabase
        .from('round')
        .delete()
        .in('category_id', categoryIds)
      if (roundErr) throw roundErr

      // 9) Supprimer les liaisons age ↔ catégorie
      const { error: ageLinkErr } = await supabase
        .from('category_category_age')
        .delete()
        .in('category_id', categoryIds)
      if (ageLinkErr) throw ageLinkErr

      // 10) Supprimer les inscriptions aux catégories
      const { error: regErr } = await supabase
        .from('category_registration')
        .delete()
        .in('category_id', categoryIds)
      if (regErr) throw regErr

      // 11) Supprimer les catégories
      const { error: catErr } = await supabase
        .from('category')
        .delete()
        .in('id', categoryIds)
      if (catErr) throw catErr

      // 12) Supprimer les tournois du club
      const { error: tourErr2 } = await supabase
        .from('tournament')
        .delete()
        .eq('id_club', clubId)
      if (tourErr2) throw tourErr2

      // 13) Supprimer les images stockées du club
      const folder = `${clubId}/images`
      const { data: files, error: storageListErr } = await supabase
        .storage
        .from('club-images')
        .list(folder)
      if (storageListErr) throw storageListErr
      if (files.length) {
        const { error: storageDelErr } = await supabase
          .storage
          .from('club-images')
          .remove(files.map(f => `${folder}/${f.name}`))
        if (storageDelErr) throw storageDelErr
      }

      // 14) Supprimer le club
      const { error: clubErr } = await supabase
        .from('club')
        .delete()
        .eq('id', clubId)
      if (clubErr) throw clubErr

      reply.send({ message: 'Club et toutes ses dépendances ont été supprimés.' })
    } catch (err) {
      fastify.log.error(err)
      reply.status(500).send({ message: 'Erreur lors de la suppression en cascade.', details: err.message })
    }
  });

}
