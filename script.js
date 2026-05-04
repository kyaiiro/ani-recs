// GraphQL query for AniList with pagination support
// Uses page and perPage parameters to fetch all entries across multiple pages
const QUERY = `
  query ($username: String, $status: MediaListStatus, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
        total
        currentPage
        lastPage
      }
      mediaList(userName: $username, type: ANIME, status: $status) {
        score(format: POINT_100)
        media {
          id
          title { romaji english }
          genres
          tags { name rank }
        }
      }
    }
  }
`;

let allAnime = [];
let isLoading = false;

// Fetch ALL entries for a specific status using pagination
// Automatically follows pagination until all pages are fetched
async function fetchAllByStatus(username, status, onProgress = null) {
  let allEntries = [];
  let currentPage = 1;
  const perPage = 50; // Max per page allowed by AniList
  let hasNextPage = true;
  
  while (hasNextPage) {
    try {
      const response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: QUERY,
          variables: { username, status, page: currentPage, perPage }
        })
      });
      
      const json = await response.json();
      if (json.errors) throw new Error(json.errors[0].message);
      
      const pageData = json.data?.Page;
      if (!pageData) break;
      
      const mediaList = pageData.mediaList || [];
      const pageInfo = pageData.pageInfo;
      
      // Process entries from this page
      for (const entry of mediaList) {
        if (!entry || !entry.media) continue;
        const score = entry.score ?? 0;
        // Only include if score > 8
        if (score < 85) continue;
        
        const media = entry.media;
        const title = media.title?.english || media.title?.romaji || "Untitled";
        const genres = media.genres || [];
        const allTagsRaw = media.tags || [];
        
        // All prominent tags (rank >= 60) - used for exclusion filtering
        const allProminentTags = allTagsRaw
          .filter(tag => tag.rank >= 60)
          .map(tag => tag.name);
        
        // Top 3 tags for display (sorted by rank descending)
        const sortedProminent = [...allTagsRaw.filter(t => t.rank >= 60)].sort((a, b) => b.rank - a.rank);
        const displayTags = sortedProminent.slice(0, 3).map(t => t.name);
        
        allEntries.push({
          title: title,
          score: score,
          genres: genres,
          allProminentTags: allProminentTags,
          displayTags: displayTags,
          status: status,
          mediaId: media.id
        });
      }
      
      // Check if there are more pages
      hasNextPage = pageInfo?.hasNextPage || false;
      currentPage++;
      
      // Update progress if callback provided
      if (onProgress) {
        const currentTotal = allEntries.length;
        const totalEstimate = pageInfo?.total || (pageInfo?.lastPage ? pageInfo.lastPage * perPage : currentTotal);
        onProgress(status, currentTotal, totalEstimate, currentPage - 1, pageInfo?.lastPage);
      }
      
    } catch (err) {
      console.error(`Error fetching ${status} page ${currentPage}:`, err);
      throw err;
    }
  }
  
  return allEntries;
}

// Main fetch function - always uses "MrGeo" as username
// Fetches all pages for both CURRENT and COMPLETED statuses
async function fetchData() {
  if (isLoading) return;
  const fetchBtn = document.getElementById("fetch-btn");
  isLoading = true;
  fetchBtn.disabled = true;
  fetchBtn.textContent = "⏳ Loading...";
  
  // Show loading indicators with pagination info
  document.getElementById("current-list").innerHTML = '<p class="loading">🔄 Fetching CURRENT anime (paginating through all entries)...</p>';
  document.getElementById("completed-list").innerHTML = '<p class="loading">🔄 Fetching COMPLETED anime (paginating through all entries)...</p>';
  
  // Progress tracking variables
  let currentProgress = { fetched: 0, total: '...', page: 0, lastPage: '...' };
  let completedProgress = { fetched: 0, total: '...', page: 0, lastPage: '...' };
  
  // Update progress display
  const updateProgressDisplay = () => {
    const currentText = currentProgress.fetched > 0 
      ? `🔄 CURRENT: fetched ${currentProgress.fetched} titles (page ${currentProgress.page}/${currentProgress.lastPage})...`
      : '🔄 Fetching CURRENT anime...';
    const completedText = completedProgress.fetched > 0
      ? `🔄 COMPLETED: fetched ${completedProgress.fetched} titles (page ${completedProgress.page}/${completedProgress.lastPage})...`
      : '🔄 Fetching COMPLETED anime...';
    
    document.getElementById("current-list").innerHTML = `<p class="loading">${currentText}</p>`;
    document.getElementById("completed-list").innerHTML = `<p class="loading">${completedText}</p>`;
  };
  
  // Progress callbacks for each status
  const onCurrentProgress = (status, fetched, total, page, lastPage) => {
    currentProgress = { fetched, total, page, lastPage };
    updateProgressDisplay();
  };
  
  const onCompletedProgress = (status, fetched, total, page, lastPage) => {
    completedProgress = { fetched, total, page, lastPage };
    updateProgressDisplay();
  };
  
  try {
    // Fetch both statuses in parallel with pagination
    const [currentEntries, completedEntries] = await Promise.all([
      fetchAllByStatus("MrGeo", "CURRENT", onCurrentProgress),
      fetchAllByStatus("MrGeo", "COMPLETED", onCompletedProgress)
    ]);
    
    allAnime = [...currentEntries, ...completedEntries];
    
    // Update UI with success message
    const totalCount = allAnime.length;
    const currentCount = currentEntries.length;
    const completedCount = completedEntries.length;
    
    console.log(`Fetched ${totalCount} anime (${currentCount} CURRENT, ${completedCount} COMPLETED) with score >= 8.5/10`);
    
    render();
  } catch (err) {
    console.error(err);
    document.getElementById("current-list").innerHTML = `<p class="error">⚠️ Failed: ${err.message}. Make sure MrGeo exists and list is public.</p>`;
    document.getElementById("completed-list").innerHTML = '';
    allAnime = [];
    render();
  } finally {
    isLoading = false;
    fetchBtn.disabled = false;
    fetchBtn.textContent = "⟳ Fetch list";
  }
}

// Render function: applies genre filter + tag exclusion, then displays cards
function render() {
  if (!allAnime.length && !isLoading) {
    document.getElementById("current-list").innerHTML = '<p class="empty">🌟 Press "Fetch list" to see MrGeo\'s top rated (score >8)</p>';
    document.getElementById("completed-list").innerHTML = '';
    document.getElementById("current-count").textContent = '';
    document.getElementById("completed-count").textContent = '';
    return;
  }
  
  if (!allAnime.length && isLoading) return; // Still loading
  
  // Get genre filter
  const selectedGenre = document.getElementById("genre-select").value;
  
  // Get excluded tags from input
  const tagsRaw = document.getElementById("tags-input").value;
  const excludedLower = new Set();
  if (tagsRaw.trim()) {
    tagsRaw.split(",").forEach(t => {
      const trimmed = t.trim().toLowerCase();
      if (trimmed) excludedLower.add(trimmed);
    });
  }
  
  // Apply filters
  let filtered = allAnime.filter(anime => {
    // Genre match
    if (selectedGenre && selectedGenre !== "" && !anime.genres.includes(selectedGenre)) return false;
    // Excluded tags: check against allProminentTags (full list of rank >= 60 tags)
    if (excludedLower.size > 0) {
      const hasExcluded = anime.allProminentTags.some(tag => excludedLower.has(tag.toLowerCase()));
      if (hasExcluded) return false;
    }
    return true;
  });
  
  // Split by status and sort by score (highest first)
  const currentList = filtered.filter(a => a.status === "CURRENT").sort((a, b) => b.score - a.score);
  const completedList = filtered.filter(a => a.status === "COMPLETED").sort((a, b) => b.score - a.score);
  
  // Update counts
  document.getElementById("current-count").textContent = currentList.length ? `${currentList.length} titles` : "";
  document.getElementById("completed-count").textContent = completedList.length ? `${completedList.length} titles` : "";
  
  // Render grids
  const currentGrid = document.getElementById("current-list");
  const completedGrid = document.getElementById("completed-list");
  
  currentGrid.innerHTML = currentList.length 
    ? currentList.map(item => makeCard(item)).join("") 
    : '<p class="empty">✨ No current anime match filters or none with score >8.</p>';
    
  completedGrid.innerHTML = completedList.length 
    ? completedList.map(item => makeCard(item)).join("") 
    : (allAnime.length ? '<p class="empty">📭 No completed titles after filters.</p>' : '<p class="empty">──</p>');
}

// Create HTML card for an anime entry
// Clicking the card opens the anime on AniList in a new tab
function makeCard(anime) {
  const genrePills = anime.genres.map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`).join("");
  const tagPills = anime.displayTags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("");
  const anilistUrl = `https://anilist.co/anime/${anime.mediaId}`;
  
  return `
    <div class="card" onclick="window.open('${anilistUrl}', '_blank')" title="Open on AniList">
      <div class="card-title">${escapeHtml(anime.title)}</div>
      <span class="score-badge">⭐ ${anime.score/10}/10</span>
      <div class="pills">${genrePills}</div>
      ${tagPills ? `<div class="pills">🏷️ ${tagPills}</div>` : `<div class="pills"><span class="genre-pill" style="opacity:0.6;">no top tags</span></div>`}
    </div>
  `;
}

// Simple XSS prevention
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Set up event listeners when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  const genreSelect = document.getElementById("genre-select");
  const tagsInputElem = document.getElementById("tags-input");
  const fetchBtn = document.getElementById("fetch-btn");
  
  if (genreSelect) genreSelect.addEventListener("change", () => render());
  if (tagsInputElem) tagsInputElem.addEventListener("input", () => render());
  if (fetchBtn) fetchBtn.onclick = () => fetchData();
});