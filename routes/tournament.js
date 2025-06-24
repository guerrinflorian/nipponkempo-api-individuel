export default async function tournament(fastify, options) {
  const { supabase, verifyJWT } = options;

  async function syncTournament(request, reply) {
    const {
      tournaments,
      categories,
      participants,
      poolManagers,
      poules,
      brackets,
      rounds,
      matches,
      idClub
    } = request.body;

    const payload = {
      p_tournaments: tournaments,
      p_categories: categories,
      p_participants: participants,
      p_pool_managers: poolManagers,
      p_poules: poules,
      p_brackets: brackets,
      p_rounds: rounds,
      p_matches: matches,
      p_id_club: idClub
    };

    const { data: tournamentId, error } = await supabase
      .rpc('sync_tournament', payload);

    if (error) {
      return reply
        .code(400)
        .send({ error: `Import echoue  error message` });
    }

    return reply.send({
      message: 'Import termine avec succes.',
      tournament: tournamentId
    });
  }

  // route: post /sync-tournament
  // desc: crea et sync tournoi complet
  fastify.post('/sync-tournament', { preValidation: verifyJWT }, syncTournament);

  // route: get /tournament/club/:id
  // desc: recup tournoi club et inscriptions filtrées
  fastify.get(
    '/tournament/club/:id',
    { preValidation: verifyJWT },
    async (request, reply) => {
      const clubId = Number(request.params.id);
      if (Number.isNaN(clubId)) {
        return reply.code(400).send({ error: 'Parametre id invalide.' });
      }

      try {
        const { data: rawTournaments, error: tourErr } = await supabase
          .from('tournament')
          .select(`
            id,
            name,
            start_date,
            address,
            status:status_id(id, name),
            categories:category(
              id,
              name,
              id_category_type,
              category_type(name),
              id_grade_minimum,
              id_grade_maximum,
              status:status_id(id, name),
              id_gender,
              gender:gender(id, name),
              min_weight,
              max_weight,
              id_winner,
              ages:category_category_age(category_age(id, name, min_age, max_age)),
              registrations:category_registration(
                id,
                user_id,
                created_at,
                status:status_id(id, name)
              )
            )
          `)
          .eq('id_club', clubId)
          .order('start_date', { ascending: true });
        if (tourErr) throw tourErr;

        const tournamentsData = rawTournaments.map(t => ({
          ...t,
          categories: t.categories.map(c => ({
            ...c,
            registrations: c.registrations.filter(r => r.status.id === 1)
          }))
        }));

        const allRegs = tournamentsData
          .flatMap(t => t.categories)
          .flatMap(c => c.registrations);
        const regUserIds = [...new Set(allRegs.map(r => r.user_id))];

        const { data: regParticipants } = await supabase
          .from('participant')
          .select(`
            id,
            id_user,
            first_name,
            last_name,
            email,
            club,
            birth_date,
            weight,
            id_gender,
            gender(id, name),
            id_grade,
            grade(id, name),
            id_nationality
          `)
          .in('id_user', regUserIds);

        const allCategories = tournamentsData.flatMap(t => t.categories);
        const gradeIds = allCategories.reduce((acc, c) => {
          if (c.id_grade_minimum) acc.add(c.id_grade_minimum);
          if (c.id_grade_maximum) acc.add(c.id_grade_maximum);
          return acc;
        }, new Set());
        const { data: grades } = gradeIds.size > 0
          ? await supabase
            .from('grade')
            .select('id, name')
            .in('id', [...gradeIds])
          : { data: [] };

        const categoryIds = allCategories.map(c => c.id);
        const { data: allParticipants } = await supabase
          .from('category_participant')
          .select(`
            category_id,
            participant (
              id, first_name, last_name, email, club,
              birth_date, weight, id_gender, gender(id, name),
              id_grade, grade(id, name), id_nationality
            )
          `)
          .in('category_id', categoryIds);

        const [tableauCategories, poolCategories] = allCategories.reduce(
          (acc, c) => {
            acc[c.category_type.name === 'Tableau' ? 0 : 1].push(c);
            return acc;
          },
          [[], []]
        );
        const [{ data: allRounds }, { data: allPools }] = await Promise.all([
          supabase
            .from('round')
            .select('id, label, display_order, category_id')
            .in('category_id', tableauCategories.map(c => c.id))
            .order('display_order', { ascending: true }),
          supabase
            .from('pool')
            .select('id, name, category_id')
            .in('category_id', poolCategories.map(c => c.id)),
        ]);

        const roundIds = allRounds.map(r => r.id);
        const poolIds = allPools.map(p => p.id);
        const [{ data: roundMatches }, { data: poolMatches }, { data: poolRankings }] =
          await Promise.all([
            supabase
              .from('match')
              .select('*, id_round')
              .in('id_round', roundIds),
            supabase
              .from('match')
              .select('*, id_pool')
              .in('id_pool', poolIds),
            supabase
              .from('pool_ranking')
              .select('*, pool_id')
              .in('pool_id', poolIds)
              .order('position', { ascending: true }),
          ]);

        const fullTournaments = tournamentsData.map(tournament => {
          const categories = tournament.categories.map(c => {
            const gradeMin = grades.find(g => g.id === c.id_grade_minimum)?.name || null;
            const gradeMax = grades.find(g => g.id === c.id_grade_maximum)?.name || null;

            const participants = allParticipants
              .filter(p => p.category_id === c.id)
              .map(p => p.participant);

            const registrations = c.registrations.map(r => ({
              ...r,
              participant:
                regParticipants.find(p => p.id_user === r.user_id) || null
            }));

            if (c.category_type.name === 'Tableau') {
              const rounds = allRounds
                .filter(r => r.category_id === c.id)
                .map(r => ({
                  ...r,
                  matches: roundMatches
                    .filter(m => m.id_round === r.id)
                    .map(({ id_round, ...m }) => m),
                }));
              return {
                ...c,
                type: c.category_type.name,
                gradeMin,
                gradeMax,
                weightRange: [c.min_weight, c.max_weight],
                ages: c.ages.map(a => a.category_age),
                participants,
                registrations,
                rounds,
              };
            } else {
              const pools = allPools
                .filter(p => p.category_id === c.id)
                .map(p => ({
                  ...p,
                  ranking: poolRankings
                    .filter(r => r.pool_id === p.id)
                    .map(({ pool_id, ...rest }) => rest),
                  matches: poolMatches
                    .filter(m => m.id_pool === p.id)
                    .map(({ id_pool, ...m }) => m),
                }));
              return {
                ...c,
                type: c.category_type.name,
                gradeMin,
                gradeMax,
                weightRange: [c.min_weight, c.max_weight],
                ages: c.ages.map(a => a.category_age),
                participants,
                registrations,
                pools,
              };
            }
          });

          return {
            tournament: {
              id: tournament.id,
              name: tournament.name,
              start_date: tournament.start_date,
              address: tournament.address,
              status: tournament.status,
            },
            categories,
          };
        });

        return reply.send(fullTournaments);

      } catch (error) {
        fastify.log.error('Erreur serveur', error);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    }
  );

  // route: delete /tournaments/:id
  // desc: suppr tournoi et dependances
  fastify.delete(
    '/tournaments/:id',
    { preValidation: verifyJWT },
    async (req, reply) => {
      const tournamentId = Number(req.params.id);
      if (Number.isNaN(tournamentId)) {
        return reply.code(400).send({ status: 'error', message: 'ID invalide' });
      }

      async function runDelete(table, filterField, ids) {
        if (!ids || !ids.length) return;
        const { error } = await supabase
          .from(table)
          .delete()
          .in(filterField, ids);
        if (error) {
          fastify.log.error(`Erreur suppr ${table}`, error);
          throw new Error(`Echec suppr ${table} error message`);
        }
      }

      try {
        const { data: cats, error: catErr } = await supabase
          .from('category')
          .select('id')
          .eq('id_tournament', tournamentId);
        if (catErr) throw catErr;
        const catIds = cats.map(c => c.id);

        if (catIds.length) {
          const [
            { data: rounds = [], error: roundErr },
            { data: pools = [], error: poolErr }
          ] = await Promise.all([
            supabase.from('round').select('id').in('category_id', catIds),
            supabase.from('pool').select('id').in('category_id', catIds)
          ]);
          if (roundErr) throw roundErr;
          if (poolErr) throw poolErr;

          const roundIds = rounds.map(r => r.id);
          const poolIds = pools.map(p => p.id);

          await runDelete('match', 'id_round', roundIds);
          await runDelete('match', 'id_pool', poolIds);
          await runDelete('pool_ranking', 'pool_id', poolIds);
          await runDelete('pool', 'id', poolIds);
          await runDelete('round', 'id', roundIds);
          await runDelete('category_participant', 'category_id', catIds);
          await runDelete('category_category_age', 'category_id', catIds);
          await runDelete('category', 'id', catIds);
        }

        const { error: tourErr } = await supabase
          .from('tournament')
          .delete()
          .eq('id', tournamentId);
        if (tourErr) throw tourErr;

        return reply.send({
          status: 'success',
          message: 'Tournoi et dependances suppr avec succes'
        });

      } catch (err) {
        fastify.log.error('Suppression echouee', err);
        return reply
          .code(500)
          .send({ status: 'error', message: err.message });
      }
    }
  );

  // route: post /tournaments
  // desc: crea tournoi
  fastify.post('/tournaments', { preValidation: verifyJWT }, async (req, reply) => {
    const { name, address, start_date, status_id, id_club } = req.body;

    if (!name || !address || !start_date || !status_id || !id_club) {
      return reply.code(400).send({ error: 'Champs manquants' });
    }

    const { data, error } = await supabase
      .from('tournament')
      .insert({ name, address, start_date, status_id, id_club })
      .select('id')
      .single();

    if (error) {
      return reply.code(500).send({ error: `Erreur creation error message` });
    }

    return reply.send({ message: 'Tournoi cree', id: data.id });
  });

  // route: put /tournaments/:id
  // desc: modifs tournoi
  fastify.put('/tournaments/:id', { preValidation: verifyJWT }, async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'ID invalide' });
    }

    const { name, address, start_date, status_id } = req.body;

    const { error } = await supabase
      .from('tournament')
      .update({ name, address, start_date, status_id })
      .eq('id', id);

    if (error) {
      return reply.code(500).send({ error: `Erreur modifs error message` });
    }

    return reply.send({ message: 'Tournoi modifie' });
  });
}
