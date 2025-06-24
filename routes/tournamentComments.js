export default async function tournamentCommentsRoutes(fastify, options) {
    const { supabase, verifyJWT } = options

    // liste d insultes à censurer
    const INSULTS = [
        'con', 'connard', 'connasse', 'cons', 'connards', 'connasses',
        'salaud', 'salauds', 'salope', 'salopes',
        'idiot', 'idiote', 'idiots', 'idiotes',
        'débile', 'débiles', 'debile', 'debiles',
        'crétin', 'crétine', 'crétins', 'crétines', 'cretin', 'cretins',
        'pute', 'putes', 'putain', 'putains',
        'enculé', 'enculés', 'encule', 'encules', 'enculee', 'enculees',
        'bordel', 'bordels',
        'bouffon', 'bouffonne', 'bouffons', 'bouffonnes',
        'ordure', 'ordures',
        'tapette', 'tapettes',
        'pédé', 'pédés', 'pede', 'pedes',
        'pd', 'pdss', 'pds',
        'niquer', 'nique', 'niqué', 'niqués', 'niquerai', 'niquons',
        'bite', 'bites',
        'couille', 'couilles',
        'branleur', 'branleuse', 'branleurs', 'branleuses',
        'fils de pute', 'filsdepute', 'fils-de-pute',
        'merde', 'merdes',
        'chiant', 'chiante', 'chiants', 'chiantes',
        'chiotte', 'chiottes',
        'emmerder', 'emmerde', 'emmerdes', 'emmerdés', 'emmerdeur', 'emmerdeuse',
        'cul', 'culs',
        'gros con', 'grosse conne', 'grosconnard', 'grosseconnasse',
        'taré', 'tarée', 'tarés', 'tare', 'tares',
        'mongol', 'mongole', 'mongols', 'mongoles',
        'clochard', 'clocharde', 'clochards', 'clochardes',
        'salope', 'salaud', 'salopard', 'saloperie',
        'enfoiré', 'enfoirée', 'enfoires', 'enfoire', 'enfoirés',
        'trou du cul', 'trouduc', 'trouducs', 'troudcul', 'troudculs',
        'batard', 'batarde', 'bâtard', 'bâtarde', 'bâtards', 'batards',
        'gouine', 'gouines',
        'bite', 'chatte', 'chattes', 'vagin', 'verge',
        'nichon', 'nichons', 'seins', 'sein',
        'enculage', 'enculages',
        'pisse', 'pisser', 'pissé', 'pisses',
        'sucer', 'suce', 'sucé', 'sucette', 'suceuse',
        'baise', 'baiser', 'baisé', 'baises', 'baisons', 'baisée', 'baisés',
        'casser les couilles', 'cassé les couilles', 'cassecouille', 'casse-couilles',
        'nique ta mère', 'niquetamere', 'ntm', 'ntm!',
        'tg', 'ta gueule', 'tagueule', 'tg!',
        'fdp', 'fils de', 'filsde',
        'zgeg', 'zob', 'teub', 'kiki',
        'anus', 'anal', 'analement',
        'sodomie', 'sodomisé', 'sodomiser',
        'raclure', 'larbin', 'chien', 'chienne',
        'traînée', 'trainée', 'trainee', 'trainées',
        'naze', 'nazes', 'nazillon',
        'facho', 'fachos',
        'bougnoule', 'bougnoules',
        'négro', 'negro', 'negros', 'nègres', 'nègre', 'negre',
        'youpin', 'youpine', 'youpins',
        'raton', 'ratonne', 'ratons',
        'pute à clic', 'puteaclic', 'pute-a-clic',
        'petasse', 'pétasse', 'pétasses',
        'triso', 'trisomique', 'trisomiques',
        'attardé', 'attardée', 'attardés', 'attardees'
    ];


    // remplace chaque insulte par des étoiles
    function censor(content) {
        const pattern = new RegExp(`\\b(?:${INSULTS.join('|')})\\b`, 'gi')
        return content.replace(pattern, match => '*'.repeat(match.length))
    }

    // route: post /tournaments/:tid/comments
    // desc: créer un commentaire sous un tournoi avec censure
    fastify.post(
        '/tournaments/:tid/comments',
        { preValidation: verifyJWT },
        async (request, reply) => {
            const userId = request.user.id
            const tournamentId = Number(request.params.tid)
            const { content, parent_comment_id } = request.body

            // Vérifier que l'utilisateur est bien participant
            const { data: part } = await supabase
                .from('participant')
                .select('id')
                .eq('id_user', userId)
                .single()
            if (!part) {
                return reply.code(403).send({ message: 'Seuls les participants peuvent commenter.' })
            }

            // Censurer le contenu
            const clean = censor(content)

            // 1) On insert le nouveau commentaire
            const { data: created, error } = await supabase
                .from('comments')
                .insert([{
                    tournament_id: tournamentId,
                    user_id: userId,
                    parent_comment_id: parent_comment_id || null,
                    content: clean
                }])
                .select(`
            *,
            users ( id, first_name, last_name )
          `)
                .single()

            if (error) {
                request.log.error(error)
                return reply.code(500).send({ message: 'Impossible de créer le commentaire.' })
            }

            reply.code(201).send(created)

        }
    )


    // route: get /tournaments/:tid/comments
    // desc: recupp tous les commentaires d'un tournoi (ordre chrono)
    fastify.get(
        '/tournaments/:tid/comments',
        async (request, reply) => {
            const tournamentId = Number(request.params.tid)
            const { data, error } = await supabase
                .from('comments')
                .select(`
            id,
            parent_comment_id,
            content,
            created_at,
            updated_at,
            user_id,
            users(id, first_name, last_name)
          `)
                .eq('tournament_id', tournamentId)
                .order('created_at', { ascending: true })
            if (error) {
                request.log.error(error)
                return reply.code(500).send({ message: 'Impossible de charger les commentaires.' })
            }
            reply.send(data)
        }
    )

    // route: put /comments/:id
    // desc: modifier son propre commentaire
    fastify.put(
        '/comments/:id',
        { preValidation: verifyJWT },
        async (request, reply) => {
            const userId = request.user.id
            const commentId = Number(request.params.id)
            const { content } = request.body

            // 1) verif propriété
            const { data: existing, error: fetchErr } = await supabase
                .from('comments')
                .select('user_id')
                .eq('id', commentId)
                .single()
            if (fetchErr || !existing) {
                return reply.code(404).send({ message: 'Commentaire introuvable.' })
            }
            if (existing.user_id !== userId) {
                return reply.code(403).send({ message: 'Vous ne pouvez pas modifier ce commentaire.' })
            }

            // 2) censure
            const clean = censor(content)

            // 3) mise à jour
            const { data, error } = await supabase
                .from('comments')
                .update({
                    content: clean,
                    updated_at: new Date().toISOString()
                })
                .eq('id', commentId)
                .select(`
              *,
              users ( id, first_name, last_name )
            `)
            if (error) {
                request.log.error(error)
                return reply.code(500).send({ message: 'Impossible de modifier le commentaire.' })
            }

            reply.send(data[0])
        }
    )

    // route: delete /comments/:id
    // desc: supprimer son propre commentaire (cascade children)
    fastify.delete(
        '/comments/:id',
        { preValidation: verifyJWT },
        async (request, reply) => {
            const userId = request.user.id
            const commentId = Number(request.params.id)

            // 1) Vérifier propriété
            const { data: existing, error: fetchErr } = await supabase
                .from('comments')
                .select('user_id')
                .eq('id', commentId)
                .single()
            if (fetchErr || !existing) {
                return reply.code(404).send({ message: 'Commentaire introuvable.' })
            }
            if (existing.user_id !== userId) {
                return reply.code(403).send({ message: 'Vous ne pouvez pas supprimer ce commentaire.' })
            }

            // 2) suppression
            const { error } = await supabase
                .from('comments')
                .delete()
                .eq('id', commentId)
            if (error) {
                request.log.error(error)
                return reply.code(500).send({ message: 'Impossible de supprimer le commentaire.' })
            }

            reply.send({ message: 'Commentaire supprimé.' })
        }
    )
}
