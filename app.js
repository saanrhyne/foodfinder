const APP = {
    elements: {
        form: document.getElementById('searchForm'),
        zipCode: document.getElementById('zipCode'),
        radius: document.getElementById('radius'),
        preferences: document.getElementById('preferences'),
        matchAll: document.getElementById('matchAll'),
        dislikes: document.getElementById('dislikes'),
        resultsArea: document.getElementById('resultsArea'),
        statusMessage: document.getElementById('statusMessage'),
        searchBtn: document.getElementById('searchBtn')
    },

    init() {
        this.elements.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSearch();
        });
    },

    showStatus(message, type = 'info') {
        const el = this.elements.statusMessage;
        el.textContent = message;
        el.style.display = 'block';
        el.className = `status-message ${type}`;
    },

    hideStatus() {
        this.elements.statusMessage.style.display = 'none';
    },

    showLoading() {
        this.elements.resultsArea.innerHTML = '<div class="spinner"></div><p style="text-align:center; margin-top:1rem;">Cooking up some results...</p>';
    },

    async handleSearch() {
        const zip = this.elements.zipCode.value.trim();
        const radiusMiles = parseFloat(this.elements.radius.value);
        const radiusMeters = radiusMiles * 1609.34;
        
        const preferencesInput = this.elements.preferences.value.toLowerCase();
        const preferences = preferencesInput ? preferencesInput.split(',').map(s => s.trim()).filter(s => s) : [];
        
        const dislikesInput = this.elements.dislikes.value.toLowerCase();
        const dislikes = dislikesInput ? dislikesInput.split(',').map(s => s.trim()).filter(s => s) : [];
        
        const matchAll = this.elements.matchAll.checked;

        if (!zip) return;

        this.showLoading();
        this.elements.searchBtn.disabled = true;

        try {
            this.showStatus('Locating ZIP code...');
            const location = await this.geocodeZip(zip);
            
            if (!location) {
                throw new Error('Could not locate that ZIP code. Please try again.');
            }

            this.showStatus(`Searching within ${radiusMiles} miles...`);
            const rawData = await this.fetchOverpassData(location.lat, location.lon, radiusMeters);

            const restaurants = this.processData(rawData, preferences, dislikes, matchAll);

            this.renderResults(restaurants);
            this.hideStatus();

        } catch (error) {
            console.error(error);
            this.showStatus(error.message, 'error');
            this.elements.resultsArea.innerHTML = '';
        } finally {
            this.elements.searchBtn.disabled = false;
        }
    },

    async geocodeZip(zip) {
        const url = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'FoodFinderApp/1.0'
            }
        });
        if (!response.ok) throw new Error('Geocoding failed');
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon)
            };
        }
        return null;
    },

    async fetchOverpassData(lat, lon, radius) {
        const query = `
            [out:json][timeout:25];
            (
              node["amenity"~"restaurant|fast_food|cafe|pub|bar|food_court"](around:${radius},${lat},${lon});
              way["amenity"~"restaurant|fast_food|cafe|pub|bar|food_court"](around:${radius},${lat},${lon});
            );
            out center body;
        `;

        const url = 'https://overpass-api.de/api/interpreter';
        const response = await fetch(url, {
            method: 'POST',
            body: query
        });

        if (!response.ok) throw new Error('Failed to fetch restaurant data.');
        const data = await response.json();
        return data.elements;
    },

    processData(elements, preferences, dislikes, matchAll) {
        const getTags = (el) => el.tags || {};

        return elements.map(el => {
            const tags = getTags(el);
            const lat = el.lat || el.center.lat;
            const lon = el.lon || el.center.lon;
            
            const cuisineString = (tags.cuisine || '').toLowerCase();
            const cuisines = cuisineString.split(';').map(c => c.trim()).filter(c => c);
            
            if (tags.diet && tags.diet !== 'yes') cuisines.push(...tags.diet.split(';'));
            Object.keys(tags).forEach(key => {
                if (key.startsWith('diet:') && tags[key] === 'yes') {
                    cuisines.push(key.replace('diet:', ''));
                }
            });

            const name = tags.name || tags['name:en'] || 'Unnamed Restaurant';

            const houseNumber = tags['addr:housenumber'] || '';
            const street = tags['addr:street'] || '';
            const city = tags['addr:city'] || '';
            const postcode = tags['addr:postcode'] || '';
            const address = `${houseNumber} ${street}, ${city} ${postcode}`.trim();

            let image = tags.image || tags['image:url'] || null;
            if (!image && tags.wikimedia_commons) {

            }


            return {
                id: el.id,
                name,
                cuisines,
                address,
                image,
                lat,
                lon,
                tags
            };
        }).filter(place => {
            if (!place.address || place.address === ',') return false;

            if (dislikes.length > 0) {
                const hasDislike = dislikes.some(dislike => 
                    place.cuisines.some(c => c.includes(dislike)) || 
                    place.name.toLowerCase().includes(dislike)
                );
                if (hasDislike) return false;
            }

            if (preferences.length > 0) {
                if (matchAll) {
                    const allFound = preferences.every(pref => 
                        place.cuisines.some(c => c.includes(pref)) ||
                        place.name.toLowerCase().includes(pref) 
                        || (pref === 'fast food' && place.tags.amenity === 'fast_food')
                    );
                    if (!allFound) return false;
                } else {
                    const anyFound = preferences.some(pref => 
                        place.cuisines.some(c => c.includes(pref)) ||
                        place.name.toLowerCase().includes(pref) ||
                        (pref === 'fast food' && place.tags.amenity === 'fast_food')
                    );
                    if (!anyFound) return false;
                }
            }

            return true;
        });
    },

    generateDiscountCode() {
        const prefix = 'FOOD';
        const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const randomChar = chars[Math.floor(Math.random() * chars.length)];
        return `${prefix}${randomChar}${randomNum}`;
    },

    assignDiscountCodes(restaurants) {
        if (restaurants.length === 0) return restaurants;
        
        const numToConsider = Math.min(3, restaurants.length);
        if (numToConsider > 0) {
            const randomIndex = Math.floor(Math.random() * numToConsider);
            restaurants[randomIndex].discountCode = this.generateDiscountCode();
        }
        
        return restaurants;
    },

    renderResults(restaurants) {
        const container = this.elements.resultsArea;
        container.innerHTML = '';

        if (restaurants.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 2rem;">No restaurants found matching your criteria. Try increasing the radius or removing filters.</div>';
            return;
        }

        const restaurantsWithDiscounts = this.assignDiscountCodes([...restaurants]);

        const countDiv = document.createElement('div');
        countDiv.textContent = `Found ${restaurants.length} places`;
        countDiv.style.fontWeight = 'bold';
        container.appendChild(countDiv);

        restaurantsWithDiscounts.forEach(place => {
            const card = document.createElement('div');
            card.className = 'restaurant-card';

            const cuisineTags = place.cuisines.slice(0, 4).map(c => `<span class="cuisine-tag">${c}</span>`).join(' ');

            const websiteHtml = `<div class="links"><a href="https://www.google.com/search?q=${encodeURIComponent(place.name + ' ' + place.address)}" target="_blank">Google It ↗</a></div>`;
            
            const discountHtml = place.discountCode ? `
                <div class="discount-badge">
                    Exclusive Discount Code 🤑: <span class="discount-code">${place.discountCode}</span>
                </div>
            ` : '';


            const mapUrl = `https://www.google.com/maps?ll=${place.lat},${place.lon}&hl=en&z=20&output=embed&t=h`;
            const mapHtml = `<iframe
                width="100%"
                height="300"
                style="border:0; border-radius: 8px;"
                loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
                src="${mapUrl}">
            </iframe>`;

            card.innerHTML = `
                <div class="map-preview">
                    ${mapHtml}
                </div>
                <div class="card-content">
                    <div class="card-header">
                        <h2 class="restaurant-name">${place.name}</h2>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
                        ${cuisineTags || '<span class="cuisine-tag" style="background:#ccc">General</span>'}
                    </div>
                    <div class="info-row">
                        <span>📍</span>
                        <span>${place.address || 'Address not available'}</span>
                    </div>
                    ${discountHtml}
                    ${websiteHtml}
                </div>
            `;

            container.appendChild(card);

            

        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    APP.init();
});

