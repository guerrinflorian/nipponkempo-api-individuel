export default async function tournamentStatus(fastify, options) {
    const { supabase } = options;

    // recup tous les statuts de tournoi
    fastify.get('/tournament-status', async (request, reply) => {
        try {
            const { data: statuses, error } = await supabase
                .from('tournament_status')
                .select('*'); // selectionne tous les statuts de tournoi
    
            if (error) throw error;
    
            reply.send(statuses);
        } catch (err) {
            fastify.log.error(err);
            reply.status(500).send('Erreur serveur');
        }
    });
}
