import type { RequestHandler } from 'express';
import { pool } from '../db.js';
import { uuid } from '../domain.js';
// Only the owner and accepted collaborators may access trip subresources.
export const requireTrip: RequestHandler = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const id = uuid.parse(req.params.id);
      const q = await pool.query(
        'SELECT id,title,(user_id=$2) AS "isOwner",transport_mode AS "transportMode",cost_settings AS "costSettings" FROM planner.trip WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=planner.trip.id AND m.user_id=$2))',
        [id, res.locals.user.id],
      );
      if (!q.rowCount) return res.status(404).json({ error: '여행을 찾을 수 없습니다.' });
      res.locals.trip = q.rows[0];
      next();
    })
    .catch(next);
};
