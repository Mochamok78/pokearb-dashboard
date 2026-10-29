require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function getEbayToken() {
  const auth = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return res.data.access_token;
}

app.post('/api/search', async (req, res) => {
  try {
    const { query, limit = 10 } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    await supabase.from('searches').insert({
      query,
      source: 'ebay',
      status: 'running'
    });

    const token = await getEbayToken();
    const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      },
      params: {
        q: query,
        limit,
        sort: 'newlyListed',
        filter: 'buyingOptions:{FIXED_PRICE|AUCTION}'
      }
    });

    const items = (response.data.itemSummaries || []).map(item => ({
      title: item.title,
      price: item.price?.value,
      currency: item.price?.currency,
      condition: item.condition,
      image: item.image?.imageUrl,
      url: item.itemWebUrl,
      itemId: item.itemId
    }));

    if (items.length > 0) {
      const dealsToInsert = items.map(item => ({
        title: item.title,
        source: 'ebay',
        ask_price: item.price ? parseFloat(item.price) : null,
        condition: item.condition,
        image_url: item.image,
        listing_url: item.url,
        item_id: item.itemId,
        status: 'new'
      }));

      await supabase.from('deals').insert(dealsToInsert);
    }

    await supabase.from('searches').update({
      results_count: items.length,
      status: 'completed'
    }).eq('query', query).order('created_at', { ascending: false }).limit(1);

    res.json({ items, total: response.data.total });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_description || err.message });
  }
});

app.post('/api/research', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const key = process.env.POKEMON_PRICE_TRACKER_KEY;
    if (!key) return res.status(500).json({ error: 'POKEMON_PRICE_TRACKER_KEY not set' });

    const response = await axios.get('https://www.pokemonpricetracker.com/api/v2/cards', {
      headers: { Authorization: `Bearer ${key}` },
      params: {
        search: query,
        includeEbay: true,
        limit: 5
      }
    });

    const cards = response.data.data || [];
    if (cards.length === 0) {
      return res.json({ error: 'No cards found', query });
    }

    const top = cards[0];
    const grades = top.ebay?.salesByGrade || {};

    const psa10 = grades.psa10?.medianPrice || null;
    const psa9 = grades.psa9?.medianPrice || null;
    const tag10 = grades.tag10?.medianPrice || null;
    const bgs10 = grades.bgs10?.medianPrice || null;
    const ungraded = top.prices?.market || null;

    const { data: saved, error } = await supabase.from('research').insert({
      card_name: top.name || query,
      set_name: top.set?.name || null,
      grade: 'PSA 10',
      market_value: psa10,
      notes: JSON.stringify({ psa9, tag10, bgs10, ungraded }),
      status: 'completed'
    }).select();

    if (error) console.error('Supabase error:', error);

    res.json({
      product: top.name,
      set: top.set?.name,
      psa10,
      psa9,
      tag10,
      bgs10,
      ungraded,
      saved: saved?.[0] || null
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pokearb dashboard running at http://localhost:${PORT}`);
});