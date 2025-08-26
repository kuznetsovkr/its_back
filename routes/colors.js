const express = require('express');
const router = express.Router();
const Color = require('../models/Color');

// GET /api/colors
router.get('/', async (req, res) => {
  try {
    const rows = await Color.findAll({ order: [['name', 'ASC']] });
    res.json(rows.map(r => ({ name: r.name, code: r.code })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch colors' });
  }
});

// POST /api/colors  body: { name, code }
router.post('/', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase();

    if (!name || !code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    // upsert в стиле Sequelize без сырых запросов
    const existing = await Color.findOne({ where: { name } });
    let row;
    if (existing) {
      existing.code = code;
      row = await existing.save();
    } else {
      row = await Color.create({ name, code });
    }

    res.status(201).json({ name: row.name, code: row.code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save color' });
  }
});

module.exports = router;
