import fastLevenshtein from 'fast-levenshtein'

export default async function participants(fastify, options) {
  const { supabase, verifyJWT } = options

  // Calcul de similarité [0..1]
  function similarity(a, b) {
    const dist = fastLevenshtein.get(a, b)
    return 1 - dist / Math.max(a.length, b.length)
  }

  // POST /participants/check
  fastify.post('/participants/check', { preValidation: verifyJWT }, async (req, reply) => {
    const { first_name, last_name, birth_date, email } = req.body
    if (!first_name || !last_name || !birth_date || !email) {
      return reply.code(400).send({ status: 'error', message: 'Champs requis manquants' })
    }

    // Normalisation
    const normEmail = email.toLowerCase().trim()
    const normFirst = first_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const normLast = last_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

    // 1. Recherche par email exact
    const { data: emailRec, error: emailErr } = await supabase
      .from('participant')
      .select('*')
      .eq('email', normEmail)
      .maybeSingle()

    if (emailErr) {
      fastify.log.error('check email error', emailErr)
      return reply.code(500).send({ status: 'error', message: 'Erreur serveur email' })
    }

    if (emailRec) {
      const recBirthDate = emailRec.birth_date.split('T')[0]
      const recFirst = emailRec.first_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      const recLast = emailRec.last_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

      // Vérification identité + date de naissance
      if (recBirthDate === birth_date && similarity(normFirst, recFirst) > 0.85 && similarity(normLast, recLast) > 0.85) {
        return reply.send({ status: 'OK', existingId: emailRec.id })
      }

      // Formatage réponse pour le front
      return reply.send({
        status: 'CONFLICT',
        conflictType: 'EMAIL_EXISTS',
        existingUser: {
          id: emailRec.id,
          first_name: emailRec.first_name,
          last_name: emailRec.last_name,
          birth_date: recBirthDate,
          email: emailRec.email,
          club: emailRec.club,
          weight: emailRec.weight,
          grade: emailRec.id_grade
        }
      })
    }

    // 2. Recherche par date de naissance
    const { data: sameBirth, error: birthErr } = await supabase
      .from('participant')
      .select('*')
      .eq('birth_date', birth_date)

    if (birthErr) {
      fastify.log.error('fetch birth error', birthErr)
      return reply.code(500).send({ status: 'error', message: 'Erreur serveur birth_date' })
    }

    // 3. Recherche exacte nom/prénom
    const exactMatch = sameBirth.find(p => {
      const fn = p.first_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      const ln = p.last_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      return fn === normFirst && ln === normLast
    })

    if (exactMatch) {
      return reply.send({ status: 'OK', existingId: exactMatch.id })
    }

    // 4. Recherche approximative
    const similar = sameBirth.filter(p => {
      const fn = p.first_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      const ln = p.last_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      return similarity(normFirst, fn) > 0.85 && similarity(normLast, ln) > 0.85
    })

    if (similar.length > 0) {
      const matches = similar.map(p => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        birth_date: p.birth_date.split('T')[0],
        club: p.club,
        weight: p.weight,
        grade: p.id_grade
      }))

      return reply.send({
        status: similar.length === 1 ? 'OK' : 'SIMILARITY_FOUND',
        existingId: similar.length === 1 ? similar[0].id : undefined,
        matches
      })
    }

    // 5. Aucun match trouvé
    return reply.send({ status: 'OK' })
  })

  // POST /participants/check-email
  fastify.post(
    '/participants/check-email',
    { preValidation: verifyJWT },
    async (req, reply) => {
      const { email } = req.body;
      if (!email) {
        return reply
          .code(400)
          .send({ status: 'error', message: 'Email manquant' });
      }

      const normEmail = String(email).toLowerCase().trim();
      // On vérifie si cet email existe déjà
      const { count, error: countErr } = await supabase
        .from('participant')
        .select('id', { count: 'exact' })
        .eq('email', normEmail);

      if (countErr) {
        fastify.log.error('check-email count error', countErr);
        return reply
          .code(500)
          .send({ status: 'error', message: 'Erreur serveur lors de la vérification de l’email' });
      }

      if (count > 0) {
        // Email déjà utilisé
        return reply
          .code(409)
          .send({ status: 'EMAIL_EXISTS', message: 'Email déjà utilisé' });
      }

      // Email disponible
      return reply
        .code(200)
        .send({ status: 'OK', message: 'Email disponible' });
    }
  );

  fastify.get('/participants', { preValidation: verifyJWT }, async (req, reply) => {
    const { tournamentId } = req.query;
  
    if (!tournamentId) {
      return reply.code(400).send({ status: 'error', message: 'Paramètre tournamentId manquant' });
    }
  
    const { data, error } = await supabase
      .from('participant')
      .select(`
        id,
        first_name,
        last_name,
        birth_date,
        club,
        weight,
        id_nationality,
        id_gender,
        gender (
          name
        ),
        id_grade,
        grade (
          name
        ),
        email,
        category_participant (
          category_id,
          category (
            id_tournament
          )
        )
      `)      
      .neq('id', -1)
      .order('last_name', { ascending: true });
  
    if (error) {
      return reply.code(500).send({ status: 'error', message: 'Erreur serveur' });
    }
  
    const participants = data.map(p => {
      const match = (p.category_participant || []).find(cp => cp.category?.id_tournament === Number(tournamentId));
      return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        birth_date: p.birth_date,
        club: p.club,
        weight: p.weight,
        id_nationality: p.id_nationality,
        id_gender: p.id_gender,
        gender: p.gender?.name ?? 'Inconnu',
        id_grade: p.id_grade,
        grade: p.grade?.name ?? 'Inconnu',
        email: p.email,
        id_tournament_category: match?.category_id || null
      };
    });
  
    reply.send({ status: 'success', participants });
  });  


  // DELETE /participants/:id
  fastify.delete('/participants/:id', { preValidation: verifyJWT }, async (req, reply) => {
    const { id } = req.params
    const { error } = await supabase.from('participant').delete().eq('id', id)
    if (error) return reply.code(500).send({ status: 'error', message: 'Erreur suppression' })
    reply.send({ status: 'success', message: 'Participant supprimé' })
  })

  fastify.post('/participants', { preValidation: verifyJWT }, async (req, reply) => {
    const required = ['first_name', 'last_name', 'birth_date', 'email', 'id_nationality', 'id_gender', 'id_grade'];
    const missing = required.filter(f => !req.body[f]);
    if (missing.length) return reply.code(400).send({ status: 'error', message: `Champs manquants: ${missing.join(', ')}` });
  
    // 1. Vérifier que l'email n'existe pas déjà
    const { count, error: cntErr } = await supabase
      .from('participant')
      .select('*', { count: 'exact' })
      .eq('email', req.body.email);
    if (cntErr) return reply.code(500).send({ status: 'error', message: 'Erreur email' });
    if (count > 0) return reply.code(409).send({ status: 'EMAIL_EXISTS', message: 'Email déjà utilisé' });
  
    // 2. Insérer le participant
    const { data, error } = await supabase
      .from('participant')
      .insert([req.body])
      .select();
    if (error) return reply.code(500).send({ status: 'error', message: 'Erreur création' });
  
    const participant = data[0];
  
    // 3. Lier au user existant (si email vérifié)
    const { data: userData, error: userErr } = await supabase
      .from('users')
      .select('id, email_verified')
      .eq('email', req.body.email)
      .single();
  
    if (!userErr
        && userData
        && userData.email_verified
        // (optionnel) && !participant.id_user 
    ) {
      await supabase
        .from('participant')
        .update({ id_user: userData.id })
        .eq('id', participant.id);
      // pour renvoyer la fiche à jour :
      participant.id_user = userData.id;
    }
  
    // 4. Réponse finale
    reply.send({ status: 'success', participant });
  });  

// GET /participants/:id
fastify.get(
  '/participants/:id',
  { preValidation: verifyJWT },
  async (req, reply) => {
    const { id } = req.params
    if (!id) {
      return reply
        .code(400)
        .send({ status: 'error', message: 'ID manquant' })
    }

    const { data: participant, error } = await supabase
      .from('participant')
      .select(
        'id, first_name, last_name, birth_date, club, weight, id_nationality, id_gender, id_grade, email'
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      fastify.log.error('Erreur récupération participant', error)
      return reply
        .code(500)
        .send({ status: 'error', message: 'Erreur serveur' })
    }
    if (!participant) {
      return reply
        .code(404)
        .send({ status: 'error', message: `Participant ${id} introuvable` })
    }

    reply.send({ status: 'success', participant })
  }
)

// recup les statistiques d'un participant
fastify.get(
  '/participants/:id/statistics',
  { preValidation: verifyJWT },
  async (request, reply) => {
    const participantId = Number(request.params.id)
    if (Number.isNaN(participantId)) {
      return reply
        .code(400)
        .send({ status: 'error', message: 'ID de participant invalide' })
    }

    try {
      // 1) recup tous les matchs (pool ET round)
      const { data: matchesData, error: matchErr } = await supabase
        .from('match')
        .select(`
          id,
          id_participant1,
          id_participant2,
          id_winner,
          ippons_participant1,
          ippons_participant2,
          keikokus_participant1,
          keikokus_participant2,
          pool (
            category (
              name,
              category_type ( name ),
              tournament ( name )
            )
          ),
          round (
            category (
              name,
              category_type ( name ),
              tournament ( name )
            )
          )
        `)
        .or(`id_participant1.eq.${participantId},id_participant2.eq.${participantId}`)
      if (matchErr) throw matchErr

      // 2) recup les noms/prénoms de tous les participants
      const allIds = Array.from(new Set(
        matchesData.flatMap(m => [m.id_participant1, m.id_participant2])
      ))
      const { data: partsData, error: partsErr } = await supabase
        .from('participant')
        .select('id, first_name, last_name')
        .in('id', allIds)
      if (partsErr) throw partsErr

      const participantsMap = {}
      partsData.forEach(p => {
        participantsMap[p.id] = {
          firstName: p.first_name,
          lastName:  p.last_name
        }
      })

      // 3) formatter chaque match en gérant pool OU round
      const matches = matchesData.map(m => {
        const isFirst = m.id_participant1 === participantId

        // choix de la source de catégorie
        const catSource = m.pool
          ? m.pool.category
          : (m.round ? m.round.category : null)

        const tournamentName = catSource?.tournament?.name || '—'
        const categoryName   = catSource?.name               || '—'
        const matchType      = catSource?.category_type?.name || '—'

        const scoredIppons   = isFirst ? m.ippons_participant1   : m.ippons_participant2
        const concededIppons = isFirst ? m.ippons_participant2   : m.ippons_participant1
        const scoredKeikokus = isFirst ? m.keikokus_participant1 : m.keikokus_participant2
        const concededKeikokus = isFirst ? m.keikokus_participant2 : m.keikokus_participant1

        return {
          id: m.id,
          participant1: participantsMap[m.id_participant1],
          participant2: participantsMap[m.id_participant2],
          tournamentName,
          categoryName,
          matchType,      // "Poule" ou "Tableau"
          ipponsScored:   scoredIppons,
          ipponsConceded: concededIppons,
          keikokusScored:   scoredKeikokus,
          keikokusConceded: concededKeikokus,
          won: m.id_winner === participantId
        }
      })

      // 4) statistiques générales
      const totalMatches = matches.length
      const totalWon     = matches.filter(m => m.won).length
      const totalLost    = totalMatches - totalWon
      const winRate      = totalMatches > 0
        ? Math.round((totalWon / totalMatches) * 10000) / 100
        : 0

      const ipponsScored   = matches.reduce((sum, m) => sum + m.ipponsScored, 0)
      const ipponsConceded = matches.reduce((sum, m) => sum + m.ipponsConceded, 0)
      const keikokusScored   = matches.reduce((sum, m) => sum + m.keikokusScored, 0)
      const keikokusConceded = matches.reduce((sum, m) => sum + m.keikokusConceded, 0)

      // 5) catégories jouées et gagnées
      const categoriesPlayed = new Set(
        matches.map(m => m.categoryName)
      ).size
      const categoriesWon = new Set(
        matches.filter(m => m.won).map(m => m.categoryName)
      ).size

      // 6) renvoi de la réponse
      reply.send({
        status: 'success',
        data: {
          matches,
          generalStatistics: {
            categoriesPlayed,
            categoriesWon,
            totalMatches,
            totalWon,
            totalLost,
            winRate,           // en %
            ipponsScored,
            ipponsConceded,
            keikokusScored,
            keikokusConceded
          }
        }
      })
    } catch (err) {
      console.error('Erreur /participants/:id/statistics →', err)
      reply
        .code(500)
        .send({ status: 'error', message: err.message || 'Erreur serveur' })
    }
  }
)

  
}
