import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, TrendingUp, FileText, Calendar } from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'https://gaming-news-api.onrender.com/api';

export default function NewsDashboard() {
  const [lawsuits, setLawsuits] = useState([]);
  const [stats, setStats] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState({ priority: 'all', view: 'recent' });

  useEffect(() => {
    fetchData();
    fetchStats();
    fetchScanStatus();
  }, [filter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const endpoint = filter.view === 'recent' ? '/lawsuits/recent' : '/lawsuits';
      const params = new URLSearchParams();
      if (filter.priority !== 'all') params.append('priority', filter.priority);
      
      const response = await fetch(`${API_URL}${endpoint}?${params}`);
      const data = await response.json();
      setLawsuits(data.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_URL}/lawsuits/stats`);
      const data = await response.json();
      setStats(data.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchScanStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/scan/status`);
      const data = await response.json();
      setLastScan(data.lastScan);
    } catch (error) {
      console.error('Error fetching scan status:', error);
    }
  };

  const triggerScan = async () => {
    setScanning(true);
    try {
      const response = await fetch(`${API_URL}/scan/lawsuits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoursBack: 168 })
      });
      const data = await response.json();
      alert(data.message);
      fetchData();
      fetchStats();
      fetchScanStatus();
    } catch (error) {
      console.error('Scan error:', error);
      alert('Scan failed: ' + error.message);
    }
    setScanning(false);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Gaming News Intelligence Dashboard
          </h1>
          <p className="text-gray-600">
            Automated tracking of lawsuits, trademarks, and industry signals
          </p>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Cases</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
                <FileText className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">High Priority</p>
                  <p className="text-2xl font-bold text-red-600">{stats.high_priority}</p>
                </div>
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Last 7 Days</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.last_week}</p>
                </div>
                <Calendar className="w-8 h-8 text-green-500" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Last 30 Days</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.last_month}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-purple-500" />
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-4 items-center">
            <div>
              <label className="text-sm text-gray-600 mr-2">Priority:</label>
              <select
                value={filter.priority}
                onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
                className="border border-gray-300 rounded px-3 py-2"
              >
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600 mr-2">View:</label>
              <select
                value={filter.view}
                onChange={(e) => setFilter({ ...filter, view: e.target.value })}
                className="border border-gray-300 rounded px-3 py-2"
              >
                <option value="recent">Recent (7 days)</option>
                <option value="all">All Cases</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {lastScan && (
              <span className="text-sm text-gray-600">
                Last scan: {formatDate(lastScan)}
              </span>
            )}
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Run Scan'}
            </button>
          </div>
        </div>

        {/* Lawsuits List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Lawsuit Tracker
            </h2>
          </div>
          
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : lawsuits.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No cases found. Try running a scan or adjusting filters.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {lawsuits.map((lawsuit) => (
                <div key={lawsuit.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">
                          {lawsuit.company_name}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded border ${getPriorityColor(lawsuit.priority)}`}>
                          {lawsuit.priority?.toUpperCase()}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-gray-800 mb-1">
                        {lawsuit.case_name}
                      </h3>
                      <div className="flex gap-4 text-xs text-gray-600 mb-2">
                        <span>Docket: {lawsuit.docket_number}</span>
                        <span>Filed: {formatDate(lawsuit.date_filed)}</span>
                        <span>Court: {lawsuit.court}</span>
                      </div>
                      {lawsuit.keywords && lawsuit.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {lawsuit.keywords.map((keyword, idx) => (
                            <span key={idx} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                      {lawsuit.cause && (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {lawsuit.cause}
                        </p>
                      )}
                    </div>
                    <a
                      href={lawsuit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-4 text-blue-600 hover:text-blue-800 text-sm whitespace-nowrap"
                    >
                      View Details →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Data sources: CourtListener API</p>
          <p className="mt-1">More scanners coming soon: Trademarks, Job Postings, SEC Filings</p>
        </div>
      </div>
    </div>
  );
}