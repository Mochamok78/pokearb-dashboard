require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { PriceChartingClient } = require('@deansasek/pricecharting-api/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const pcClient = new PriceChartingClient({ requestDelay: 800 });

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

// PriceCharting graded research endpoint
app.post('/api/research', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const searchResults = await pcClient.search(query, { category: 'pokemon-cards' });
    if (!searchResults.success || !searchResults.products?.length) {
      return res.json({ error: 'No results found', products: [] });
    }

    const top = searchResults.products[0];
    const detail = await pcClient.getProductPrice(top.gameSlug || top.consoleSlug, top.productSlug || top.slug);

    const grades = (detail.grades || []).map(g => ({
      grade: g.grade,
      price: g.price
    }));

    const psa10 = grades.find(g => g.grade?.toLowerCase().includes('psa 10'))?.price || null;
    const ungraded = grades.find(g => g.grade?.toLowerCase().includes('ungraded'))?.price || null;

    // Save to research table
    const { data: saved, error } = await supabase.from('research').insert({
      card_name: top.productName || query,
      set_name: top.consoleName || null,
      grade: 'PSA 10',
      market_value: psa10,
      notes: JSON.stringify({ ungraded, allGrades: grades }),
      status: 'completed'
    }).select();

    if (error) console.error('Supabase insert error:', error);

    res.json({
      product: top.productName,
      set: top.consoleName,
      psa10,
      ungraded,
      grades,
      saved: saved?.[0] || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pokearb dashboard running at http://localhost:${PORT}`);
});