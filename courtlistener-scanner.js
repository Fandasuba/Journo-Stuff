// courtlistener-scanner.js
// CourtListener API scanner for tracking gaming company lawsuits

// Note: Using native fetch (available in Node 18+)
const companiesData = require('./companies.json');

class CourtListenerScanner {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://www.courtlistener.com/api/rest/v4';
  }

  /**
   * Search for cases involving a specific company
   * CHANGED: Now uses /search/ endpoint which actually works for discovery
   */
  async searchCases(companyName, dateAfter = null) {
    const params = new URLSearchParams({
      q: `"${companyName}"`,
      type: 'r' // r = RECAP dockets
    });

    if (dateAfter) {
      params.append('filed_after', dateAfter); // V4 uses filed_after
    }

    const url = `${this.baseUrl}/search/?${params}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`CourtListener API error: ${response.status}`);
      }

      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error(`Error searching cases for ${companyName}:`, error);
      return [];
    }
  }

  /**
   * Get detailed information about a specific docket
   */
  async getDocketDetails(docketId) {
    try {
      const response = await fetch(`${this.baseUrl}/dockets/${docketId}/`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`CourtListener API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching docket ${docketId}:`, error);
      return null;
    }
  }

  /**
   * Scan all companies for new cases
   */
  async scanAllCompanies(hoursBack = 24) {
    const dateAfter = new Date();
    dateAfter.setHours(dateAfter.getHours() - hoursBack);
    const dateString = dateAfter.toISOString().split('T')[0];

    const results = [];

    // Get high priority companies first
    const highPriorityCompanies = companiesData.companies.filter(
      c => c.priority === 'high'
    );

     const totalCompanies = highPriorityCompanies.length;
  
  // Emit initial count
  if (onProgress) {
    onProgress({
      message: `Scanning ${totalCompanies} companies...`,
      currentCompany: 0,
      totalCompanies: totalCompanies,
      companyName: ''
    });
  }
  
  console.log(`Scanning ${totalCompanies} high priority companies...`);

  let companyIndex = 0;
  for (const company of highPriorityCompanies) {
    companyIndex++;
    
    // EMIT COMPANY NAME TO SOCKET
    if (onProgress) {
      onProgress({
        message: `Scanning ${company.name}...`,
        currentCompany: companyIndex,
        totalCompanies: totalCompanies,
        companyName: company.name  // This gets sent to frontend
      });
    }

    console.log(`Checking ${company.name}...`);

    for (const legalName of company.legalNames) {
      const cases = await this.searchCases(legalName, dateString);
      
      if (cases.length > 0) {
        results.push({
          company: company.name,
          companyId: company.id,
          searchTerm: legalName,
          cases: cases,
          scannedAt: new Date().toISOString()
        });

        console.log(`  Found ${cases.length} case(s) for ${legalName}`);
      }

      await this.sleep(1000);
    }
  }

  return results;
}

  /**
   * Analyze a case for interesting keywords
   */
  analyzeCase(caseData) {
    const interestingKeywords = [
      'antitrust',
      'class action',
      'sexual harassment',
      'discrimination',
      'trade secrets',
      'intellectual property',
      'copyright',
      'trademark',
      'patent',
      'employment',
      'wrongful termination',
      'securities fraud',
      'consumer protection',
      'privacy',
      'data breach',
      'loot box',
      'gambling',
      'unfair business practices'
    ];

    const caseText = `${caseData.caseName || ''} ${caseData.docketNumber || ''} ${caseData.cause || ''}`.toLowerCase();
    
    const foundKeywords = interestingKeywords.filter(keyword => 
      caseText.includes(keyword.toLowerCase())
    );

    return {
      isInteresting: foundKeywords.length > 0,
      keywords: foundKeywords,
      priority: foundKeywords.length >= 2 ? 'high' : foundKeywords.length === 1 ? 'medium' : 'low'
    };
  }

  /**
   * Format results for dashboard display
   * CHANGED: Updated field names to match V4 search API response format
   */
  formatResults(scanResults) {
    const formatted = [];

    for (const result of scanResults) {
      for (const caseData of result.cases) {
        const analysis = this.analyzeCase(caseData);
        
        formatted.push({
          id: caseData.docket_id, // V4 search uses docket_id not id
          company: result.company,
          companyId: result.companyId,
          caseName: caseData.caseName, // V4 search uses caseName (camelCase)
          docketNumber: caseData.docketNumber, // V4 search uses docketNumber (camelCase)
          court: caseData.court, // Court name as string
          dateFiled: caseData.dateFiled, // V4 search uses dateFiled (camelCase)
          cause: caseData.cause,
          url: `https://www.courtlistener.com${caseData.docket_absolute_url}`, // V4 uses docket_absolute_url
          analysis: analysis,
          scannedAt: result.scannedAt
        });
      }
    }

    // Sort by priority and date
    formatted.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityDiff = priorityOrder[a.analysis.priority] - priorityOrder[b.analysis.priority];
      
      if (priorityDiff !== 0) return priorityDiff;
      
      return new Date(b.dateFiled) - new Date(a.dateFiled);
    });

    return formatted;
  }

  /**
   * Sleep helper for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in backend
module.exports = CourtListenerScanner;

// Example usage:
/*
const scanner = new CourtListenerScanner('your-api-key-here');

// Scan for cases in the last 24 hours
scanner.scanAllCompanies(24).then(results => {
  const formatted = scanner.formatResults(results);
  console.log('Found cases:', formatted);
});
*/