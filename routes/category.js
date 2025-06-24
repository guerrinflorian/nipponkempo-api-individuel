// routes/category.js
export default async function category(fastify, options) {
  const { supabase, verifyJWT } = options

  const handleError = (reply, error, message) => {
    fastify.log.error(error)
    reply.code(500).send({ error: `${message}: ${error.message}` })
  }

  // route: post /categories
  // desc: crea categorie
  fastify.post('/categories', { preValidation: verifyJWT }, async (req, reply) => {
    try {
      // 1) Création de la catégorie (seuls les champs de 'category')
      const {
        name,
        id_gender,
        id_category_type,
        id_grade_minimum,
        id_grade_maximum,
        min_weight,
        max_weight,
        id_tournament,
        ageCategoryIds
      } = req.body

      const { data: newCat, error: catErr } = await supabase
        .from('category')
        .insert({
          name,
          id_gender,
          id_category_type,
          id_grade_minimum,
          id_grade_maximum,
          min_weight,
          max_weight,
          id_tournament,
          status_id: 1
        })
        .select('id')
        .single()
      if (catErr) throw catErr

      const newCatId = newCat.id

      // 2) Insertion des âges associés
      if (Array.isArray(ageCategoryIds) && ageCategoryIds.length > 0) {
        const ageLinks = ageCategoryIds.map(ageId => ({
          category_id: newCatId,
          category_age_id: ageId
        }))
        const { error: linkErr } = await supabase
          .from('category_category_age')
          .insert(ageLinks)
        if (linkErr) throw linkErr
      }

      reply.send({ id: newCatId })
    } catch (error) {
      handleError(reply, error, 'Erreur creation categorie')
    }
  })

  // route: put /categories/:id
  // desc: modifs categorie
  fastify.put('/categories/:id', { preValidation: verifyJWT }, async (req, reply) => {
    try {
      const catId = Number(req.params.id)
      if (Number.isNaN(catId)) {
        return reply.code(400).send({ error: 'ID invalide' })
      }

      // On extrait les champs de catégorie + la liste ageCategoryIds
      const {
        name,
        id_gender,
        id_category_type,
        id_grade_minimum,
        id_grade_maximum,
        min_weight,
        max_weight,
        id_tournament,
        ageCategoryIds
      } = req.body

      // 1) Supprimer les anciennes liaisons d'âges
      await supabase
        .from('category_category_age')
        .delete()
        .eq('category_id', catId)

      // 2) Recréer les nouvelles liaisons d'âges
      if (Array.isArray(ageCategoryIds) && ageCategoryIds.length > 0) {
        const ageLinks = ageCategoryIds.map(ageId => ({
          category_id: catId,
          category_age_id: ageId
        }))
        const { error: linkErr } = await supabase
          .from('category_category_age')
          .insert(ageLinks)
        if (linkErr) throw linkErr
      }

      // 3) Mise à jour des colonnes de 'category'
      const { error: updErr } = await supabase
        .from('category')
        .update({
          name,
          id_gender,
          id_category_type,
          id_grade_minimum,
          id_grade_maximum,
          min_weight,
          max_weight,
          id_tournament
        })
        .eq('id', catId)
      if (updErr) throw updErr

      reply.send({ message: 'Catégorie modifiée' })
    } catch (error) {
      handleError(reply, error, 'Erreur modifs categorie')
    }
  })

  // route: delete /categories/:id
  // desc: suppr categorie
  fastify.delete('/categories/:id', { preValidation: verifyJWT }, async (req, reply) => {
    try {
      const catId = Number(req.params.id)
      if (Number.isNaN(catId)) {
        return reply.code(400).send({ error: 'ID invalide' })
      }

      // Supprimer les participants liés
      await supabase
        .from('category_participant')
        .delete()
        .eq('category_id', catId)

      // Supprimer les liens d'âges
      await supabase
        .from('category_category_age')
        .delete()
        .eq('category_id', catId)

      // Puis supprimer la catégorie elle-même
      const { error } = await supabase
        .from('category')
        .delete()
        .eq('id', catId)
      if (error) throw error

      reply.send({ message: 'Catégorie supprimée' })
    } catch (error) {
      handleError(reply, error, 'Erreur suppr categorie')
    }
  })

  // route: post /category-participant
  // desc: ajout participant a categorie
  fastify.post('/category-participant', { preValidation: verifyJWT }, async (req, reply) => {
    try {
      const { category_id, participant_id } = req.body
      const { data, error } = await supabase
        .from('category_participant')
        .insert({ category_id, participant_id })
        .select('*')
        .single()
      if (error) throw error
      reply.send(data)
    } catch (error) {
      handleError(reply, error, 'Erreur ajout participant')
    }
  })

  // route: delete /category-participant
  // desc: suppr participant de categorie
  fastify.delete('/category-participant', { preValidation: verifyJWT }, async (req, reply) => {
    try {
      const { category_id, participant_id } = req.body
      if (!category_id || !participant_id) {
        return reply.code(400).send({ error: 'category_id et participant_id requis' })
      }
      const { error } = await supabase
        .from('category_participant')
        .delete()
        .match({ category_id, participant_id })
      if (error) throw error
      reply.send({ message: 'Participant retiré de la catégorie' })
    } catch (err) {
      handleError(reply, err, 'Erreur suppr participant')
    }
  })

  // route: put /categories/:id/status
  // desc: modif statut categorie
  fastify.put('/categories/:id/status', { preValidation: verifyJWT }, async (req, reply) => {
    try {
      const catId = Number(req.params.id)
      if (isNaN(catId)) return reply.code(400).send({ error: 'ID invalide' })

      const { status_id } = req.body
      if (![1, 2, 3, 4, 5].includes(status_id)) {
        return reply.code(400).send({ error: 'Statut invalide' })
      }

      const { error } = await supabase
        .from('category')
        .update({ status_id })
        .eq('id', catId)

      if (error) throw error
      reply.send({ message: 'Statut mis à jour' })
    } catch (err) {
      handleError(reply, err, 'Erreur modif statut')
    }
  })

  // route: get /categories/:id/registration-status
  // desc: recup statut inscription categorie
  fastify.get(
    '/categories/:id/registration-status',
    { preValidation: verifyJWT },
    async (request, reply) => {
      const userId = request.user.id
      const categoryId = parseInt(request.params.id, 10)
      try {
        const { data: reg, error } = await supabase
          .from('category_registration')
          .select(`status:status_id(name)`)    // ← plus de color ici
          .eq('category_id', categoryId)
          .eq('user_id', userId)
          .single()

        if (error && error.code !== 'PGRST116') throw error
        if (!reg) return reply.send({ registered: false })

        return reply.send({
          registered: true,
          status: reg.status       // { name: "En attente" } par exemple
        })
      } catch (err) {
        fastify.log.error(err)
        reply.status(500).send({ message: 'Erreur serveur' })
      }
    }
  )

  // route: post /categories/:id/register
  // desc: crea inscription categorie
  fastify.post(
    '/categories/:id/register',
    { preValidation: verifyJWT },
    async (request, reply) => {
      const userId = request.user.id
      const categoryId = parseInt(request.params.id, 10)
      try {
        // Vérifier qu'il n'existe pas déjà
        const { data: existing, error: existErr } = await supabase
          .from('category_registration')
          .select('id')
          .eq('category_id', categoryId)
          .eq('user_id', userId)
          .single()
        if (existErr && existErr.code !== 'PGRST116') throw existErr
        if (existing) {
          // Renvoie simplement l'inscription existante
          return reply.code(400).send({ message: 'Vous êtes déjà inscrit à cette catégorie.' })
        }

        // Créer l'inscription avec status_id = 1
        const now = new Date().toISOString()
        const { data, error } = await supabase
          .from('category_registration')
          .insert([{
            category_id: categoryId,
            user_id: userId,
            status_id: 1,
            created_at: now
          }])
          .select('id, status_id')

        if (error) throw error

        reply.send({
          message: 'Inscription enregistrée.',
          registration: data[0]
        })
      } catch (err) {
        fastify.log.error(err)
        reply.status(500).send({ message: 'Erreur serveur lors de l’inscription.' })
      }
    }
  )

  // route: put /category-registration/:id
  // desc: modifs statut inscription participant
  fastify.put(
    '/category-registration/:id',
    { preValidation: verifyJWT },
    async (request, reply) => {
      // 1) Récupérer et valider l’ID de l’inscription
      const regId = parseInt(request.params.id, 10)
      if (Number.isNaN(regId)) {
        return reply.code(400).send({ error: 'ID d’inscription invalide.' })
      }

      // 2) Valider le nouveau statut (2 = refusé, 3 = accepté)
      const { status_id } = request.body
      if (![2, 3].includes(status_id)) {
        return reply.code(400).send({ error: 'Statut invalide pour une inscription.' })
      }

      try {
        // 3) Récupérer la ligne d’inscription
        const { data: reg, error: fetchErr } = await supabase
          .from('category_registration')
          .select('category_id, user_id')
          .eq('id', regId)
          .single()
        if (fetchErr) throw fetchErr

        // 4) Mettre à jour le statut de l’inscription
        const { error: updErr } = await supabase
          .from('category_registration')
          .update({ status_id })
          .eq('id', regId)
        if (updErr) throw updErr

        // 5) Récupérer l’ID du participant lié à cet user_id
        const { data: participant, error: partErr } = await supabase
          .from('participant')
          .select('id')
          .eq('id_user', reg.user_id)
          .single()
        if (partErr) throw partErr

        // 6) Si refusé : supprimer le lien category_participant s’il existe
        if (status_id === 2) {
          const { error: delErr } = await supabase
            .from('category_participant')
            .delete()
            .eq('category_id', reg.category_id)
            .eq('participant_id', participant.id)
          if (delErr) throw delErr

          return reply.send({
            message: 'Inscription refusée et lien supprimé si existant.'
          })
        }

        // 7) Si accepté : vérifier qu’il n’y a pas déjà de lien, puis insérer
        if (status_id === 3) {
          // 7a) Tenter de récupérer un lien existant
          let existing = null
          try {
            const { data, error: existErr } = await supabase
              .from('category_participant')
              .select('id')
              .eq('category_id', reg.category_id)
              .eq('participant_id', participant.id)
              .single()
            if (existErr && existErr.code !== 'PGRST116') throw existErr
            existing = data
          } catch (e) {
            throw e
          }

          // 7b) Si pas de lien, on crée la liaison
          if (!existing) {
            const { error: linkErr } = await supabase
              .from('category_participant')
              .insert({
                category_id: reg.category_id,
                participant_id: participant.id
              })
            if (linkErr) throw linkErr
          }

          return reply.send({
            message: 'Inscription acceptée et participant ajouté (si nouveau).'
          })
        }
      } catch (err) {
        fastify.log.error(err)
        return reply
          .code(500)
          .send({ error: `Erreur mise à jour inscription : ${err.message}` })
      }
    }
  )
}
