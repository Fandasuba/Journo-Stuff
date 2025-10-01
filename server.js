// server.js
// Express backend server for news intelligence dashboard

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const CourtListenerScanner = require('./courtlistener-scanner');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize scanner
const courtScanner = new CourtListenerScanner(process.env.COURTLISTENER_API_KEY);

// Database schema initialization
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS lawsuits (
        id SERIAL PRIMARY KEY,
        case_id VARCHAR(255) UNIQUE NOT NULL,
        company_id VARCHAR(255) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        case_name TEXT,
        docket_number VARCHAR(255),
        court VARCHAR(255),
        date_filed DATE,
        cause TEXT,
        url TEXT,
        priority VARCHAR(50),
        keywords TEXT[],
        scanned_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_company_id ON lawsuits(company_id);
      CREATE INDEX IF NOT EXISTS idx_date_filed ON lawsuits(date_filed);
      CREATE INDEX IF NOT EXISTS idx_priority ON lawsuits(priority);
      CREATE INDEX IF NOT EXISTS idx_scanned_at ON lawsuits(scanned_at);
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  } finally {
    client.release();
  }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all lawsuits with optional filters
app.get('/api/lawsuits', async (req, res) => {
  try {
    const { company, priority, limit = 50, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM lawsuits WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (company) {
      query += ` AND company_id = $${paramCount}`;
      params.push(company);
      paramCount++;
    }

    if (priority) {
      query += ` AND priority = $${paramCount}`;
      params.push(priority);
      paramCount++;
    }

    query += ` ORDER BY date_filed DESC, priority ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching lawsuits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent lawsuits (last 7 days)
app.get('/api/lawsuits/recent', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM lawsuits 
      WHERE date_filed >= NOW() - INTERVAL '7 days'
      ORDER BY date_filed DESC, priority ASC
      LIMIT 100
    `);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching recent lawsuits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get lawsuit statistics
app.get('/api/lawsuits/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority,
        COUNT(CASE WHEN priority = 'medium' THEN 1 END) as medium_priority,
        COUNT(CASE WHEN date_filed >= NOW() - INTERVAL '7 days' THEN 1 END) as last_week,
        COUNT(CASE WHEN date_filed >= NOW() - INTERVAL '30 days' THEN 1 END) as last_month
      FROM lawsuits
    `);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually trigger a scan for specific company
app.post('/api/scan/company', async (req, res) => {
  try {
    const { companyId, hoursBack = 168 } = req.body;
    
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'companyId is required' });
    }

    const companies = require('./companies.json');
    const company = companies.companies.find(c => c.id === companyId);
    
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    console.log(`Scanning ${company.name}...`);
    
    const dateAfter = new Date();
    dateAfter.setHours(dateAfter.getHours() - hoursBack);
    const dateString = dateAfter.toISOString().split('T')[0];

    let allCases = [];
    for (const legalName of company.legalNames) {
      const cases = await courtScanner.searchCases(legalName, dateString);
      if (cases.length > 0) {
        allCases.push({
          company: company.name,
          companyId: company.id,
          searchTerm: legalName,
          cases: cases,
          scannedAt: new Date().toISOString()
        });
      }
      await courtScanner.sleep(1000);
    }

    const formattedResults = courtScanner.formatResults(allCases);
    
    // Save to database
    let savedCount = 0;
    for (const lawsuit of formattedResults) {
      try {
        await pool.query(`
          INSERT INTO lawsuits (
            case_id, company_id, company_name, case_name, docket_number,
            court, date_filed, cause, url, priority, keywords
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (case_id) DO UPDATE SET
            scanned_at = NOW()
        `, [
          lawsuit.id,
          lawsuit.companyId,
          lawsuit.company,
          lawsuit.caseName,
          lawsuit.docketNumber,
          lawsuit.court,
          lawsuit.dateFiled,
          lawsuit.cause,
          lawsuit.url,
          lawsuit.analysis.priority,
          lawsuit.analysis.keywords
        ]);
        savedCount++;
      } catch (saveError) {
        console.error(`Error saving lawsuit:`, saveError);
      }
    }
    
    res.json({
      success: true,
      message: `Found ${formattedResults.length} cases for ${company.name}, saved ${savedCount}.`,
      data: {
        company: company.name,
        found: formattedResults.length,
        saved: savedCount,
        cases: formattedResults
      }
    });
  } catch (error) {
    console.error('Company scan error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually trigger a scan
app.post('/api/scan/lawsuits', async (req, res) => {
  try {
    const { hoursBack = 168 } = req.body; // Default to 7 days
    
    console.log(`Starting lawsuit scan (${hoursBack} hours back)...`);
    
    // Note: For real-time progress, you'd need websockets or SSE
    // For now, this just runs and returns when complete
    const scanResults = await courtScanner.scanAllCompanies(hoursBack);
    const formattedResults = courtScanner.formatResults(scanResults);
    
    // Save to database
    let savedCount = 0;
    for (const lawsuit of formattedResults) {
      try {
        await pool.query(`
          INSERT INTO lawsuits (
            case_id, company_id, company_name, case_name, docket_number,
            court, date_filed, cause, url, priority, keywords
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (case_id) DO UPDATE SET
            scanned_at = NOW()
        `, [
          lawsuit.id,
          lawsuit.companyId,
          lawsuit.company,
          lawsuit.caseName,
          lawsuit.docketNumber,
          lawsuit.court,
          lawsuit.dateFiled,
          lawsuit.cause,
          lawsuit.url,
          lawsuit.analysis.priority,
          lawsuit.analysis.keywords
        ]);
        savedCount++;
      } catch (saveError) {
        console.error(`Error saving lawsuit ${lawsuit.id}:`, saveError);
      }
    }
    
    res.json({
      success: true,
      message: `Scan complete. Found ${formattedResults.length} cases, saved ${savedCount}.`,
      data: {
        found: formattedResults.length,
        saved: savedCount,
        scannedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/scan/lawsuits-stream', async (req, res) => {
  const { hoursBack = 168 } = req.body;
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  const sendUpdate = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const companies = require('./companies.json');
    const totalCompanies = companies.companies.length;
    
    sendUpdate({
      status: 'started',
      message: `Starting scan of ${totalCompanies} companies`,
      progress: 0,
      total: totalCompanies
    });

    const dateAfter = new Date();
    dateAfter.setHours(dateAfter.getHours() - hoursBack);
    const dateString = dateAfter.toISOString().split('T')[0];

    let allCases = [];
    let processedCount = 0;

    for (const company of companies.companies) {
      processedCount++;
      
      // Send update that we're searching this company
      sendUpdate({
        status: 'searching',
        company: company.name,
        companyId: company.id,
        progress: processedCount,
        total: totalCompanies,
        percentage: Math.round((processedCount / totalCompanies) * 100)
      });

      let companyCases = [];
      for (const legalName of company.legalNames) {
        const cases = await courtScanner.searchCases(legalName, dateString);
        if (cases.length > 0) {
          companyCases.push({
            company: company.name,
            companyId: company.id,
            searchTerm: legalName,
            cases: cases,
            scannedAt: new Date().toISOString()
          });
        }
        await courtScanner.sleep(1000);
      }

      // Send update about results for this company
      const totalCasesFound = companyCases.reduce((sum, batch) => sum + batch.cases.length, 0);
      sendUpdate({
        status: 'company-complete',
        company: company.name,
        companyId: company.id,
        casesFound: totalCasesFound,
        progress: processedCount,
        total: totalCompanies
      });

      allCases.push(...companyCases);
    }

    // Format and save all results
    sendUpdate({
      status: 'saving',
      message: 'Saving results to database...'
    });

    const formattedResults = courtScanner.formatResults(allCases);
    let savedCount = 0;

    for (const lawsuit of formattedResults) {
      try {
        await pool.query(`
          INSERT INTO lawsuits (
            case_id, company_id, company_name, case_name, docket_number,
            court, date_filed, cause, url, priority, keywords
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (case_id) DO UPDATE SET
            scanned_at = NOW()
        `, [
          lawsuit.id,
          lawsuit.companyId,
          lawsuit.company,
          lawsuit.caseName,
          lawsuit.docketNumber,
          lawsuit.court,
          lawsuit.dateFiled,
          lawsuit.cause,
          lawsuit.url,
          lawsuit.analysis.priority,
          lawsuit.analysis.keywords
        ]);
        savedCount++;
      } catch (saveError) {
        console.error(`Error saving lawsuit:`, saveError);
      }
    }

    // Send completion
    sendUpdate({
      status: 'complete',
      message: `Scan complete! Found ${formattedResults.length} cases, saved ${savedCount}`,
      found: formattedResults.length,
      saved: savedCount,
      scannedAt: new Date().toISOString()
    });

    res.end();
  } catch (error) {
    console.error('Stream scan error:', error);
    sendUpdate({
      status: 'error',
      message: error.message
    });
    res.end();
  }
});

// SSE endpoint for single company scan
app.post('/api/scan/company-stream', async (req, res) => {
  const { companyId, hoursBack = 168 } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendUpdate = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (!companyId) {
      sendUpdate({ status: 'error', message: 'companyId is required' });
      return res.end();
    }

    const companies = require('./companies.json');
    const company = companies.companies.find(c => c.id === companyId);
    
    if (!company) {
      sendUpdate({ status: 'error', message: 'Company not found' });
      return res.end();
    }

    sendUpdate({
      status: 'started',
      company: company.name,
      message: `Searching ${company.name} across ${company.legalNames.length} legal name(s)`
    });

    const dateAfter = new Date();
    dateAfter.setHours(dateAfter.getHours() - hoursBack);
    const dateString = dateAfter.toISOString().split('T')[0];

    let allCases = [];
    const totalSearches = company.legalNames.length;
    let searchCount = 0;

    for (const legalName of company.legalNames) {
      searchCount++;
      
      sendUpdate({
        status: 'searching',
        searchTerm: legalName,
        progress: searchCount,
        total: totalSearches
      });

      const cases = await courtScanner.searchCases(legalName, dateString);
      if (cases.length > 0) {
        allCases.push({
          company: company.name,
          companyId: company.id,
          searchTerm: legalName,
          cases: cases,
          scannedAt: new Date().toISOString()
        });

        sendUpdate({
          status: 'found',
          searchTerm: legalName,
          casesFound: cases.length
        });
      }
      await courtScanner.sleep(1000);
    }

    sendUpdate({
      status: 'saving',
      message: 'Saving results to database...'
    });

    const formattedResults = courtScanner.formatResults(allCases);
    let savedCount = 0;

    for (const lawsuit of formattedResults) {
      try {
        await pool.query(`
          INSERT INTO lawsuits (
            case_id, company_id, company_name, case_name, docket_number,
            court, date_filed, cause, url, priority, keywords
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (case_id) DO UPDATE SET
            scanned_at = NOW()
        `, [
          lawsuit.id,
          lawsuit.companyId,
          lawsuit.company,
          lawsuit.caseName,
          lawsuit.docketNumber,
          lawsuit.court,
          lawsuit.dateFiled,
          lawsuit.cause,
          lawsuit.url,
          lawsuit.analysis.priority,
          lawsuit.analysis.keywords
        ]);
        savedCount++;
      } catch (saveError) {
        console.error(`Error saving lawsuit:`, saveError);
      }
    }

    sendUpdate({
      status: 'complete',
      company: company.name,
      message: `Found ${formattedResults.length} cases, saved ${savedCount}`,
      found: formattedResults.length,
      saved: savedCount
    });

    res.end();
  } catch (error) {
    console.error('Company stream scan error:', error);
    sendUpdate({
      status: 'error',
      message: error.message
    });
    res.end();
  }
});

// Get last scan time
app.get('/api/scan/status', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT MAX(scanned_at) as last_scan
      FROM lawsuits
    `);
    
    res.json({
      success: true,
      lastScan: result.rows[0].last_scan
    });
  } catch (error) {
    console.error('Error fetching scan status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server and initialize
async function start() {
  await initDatabase();
  
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch(console.error);