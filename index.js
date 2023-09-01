const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const fs = require('fs');
const jose = require('jose');
const mysql = require('mysql');
const maxmind = require('maxmind');
const { LRUCache } = require('lru-cache');

dotenv.config();
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to database!');
});

const mmdb = new maxmind.Reader(fs.readFileSync(process.env.MMDB_PATH));
const cityCache = new LRUCache({ max: 5000, maxAge: 1000 * 60 * 60 * 24 });
const platforms = {};
const private_key = null;
jose.importPKCS8(fs.readFileSync(process.env.PRIVATE_KEY_PATH).toString()).then((key) => {
    private_key = key;
});

function getName(names) {
    return names[process.env.DEFAULT_LANG] || names['en'] || names[Object.keys(names)[0]] || '';
}

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }))

app.get('/', (req, res) => {
    res.send('Hello World!');
});

function getCityId(ip, success, error) {
    const cityId = cityCache.get(ip);
    if (cityId !== undefined) {
        success(cityId);
        return;
    }

    const info = mmdb.get(ip);
    const city = getName(info.city.names);
    const subdivisions = info.subdivisions && info.subdivisions.map(subdivision => getName(subdivision.names)).join(', ') || '';
    const countryCode = info.country.iso_code;
    // check in database if city exists from country_code, subdivisions and city
    connection.query('SELECT id FROM cities WHERE country_code = ? AND subdivisions = ? AND city = ?', [countryCode, subdivisions, city], (err, rows) => {
        if (rows.length === 0) {
            // insert city in database
            connection.query('INSERT INTO cities (country_code, subdivisions, city, longitude, latitude) VALUES (?, ?, ?, ?, ?)', [countryCode, subdivisions, city, info.location.longitude, info.location.latitude], (err, result) => {
                if (err) {
                    console.error('Error inserting city in database:', err);
                    error('Error inserting city in database.');
                    return;
                }
                cityCache.set(ip, result.insertId);
                success(result.insertId);
            });
        } else {
            cityCache.set(ip, rows[0].id);
            success(rows[0].id);
        }
    });
}

function saveData(cityId, platformId, user, data, success, error) {
    // save data in database
    connection.query('INSERT INTO records (datetime, platform_id, city_id, user, data) VALUES (NOW(), ?, ?, ?, ?)', [platformId, cityId, user, data], (err, result) => {
        if (err) {
            console.error('Error inserting data in database:', err);
            error('Error inserting data in database.');
            return;
        }
        success();
    });
}

// Load platforms from database, indexed by key
connection.query('SELECT * FROM platforms', (err, rows) => {
    if (err) {
        console.error('Error loading platforms from database:', err);
        return;
    }
    rows.forEach((row) => {
        jose.importSPKI(row.key).then((key) => {
            platforms[row.id] = key;
        });
    });
});


async function parseJwt(body, success, error) {
    const platform_id = body.platform_id;
    if (!platforms[platform_id]) {
        error('Invalid platform_id.');
        return;
    }
    const platform_key = platforms[platform_id];
    const token = body.token;
    try {
        const { plaintext } = await jose.compactDecrypt(token, private_key);
        const { payload } = await jose.compactVerify(plaintext, platform_key);
        success(JSON.parse(payload), platform_id);
    } catch (err) {
        error('Error parsing JWT.');
    }
}


app.post('/save', (req, res) => {
    const success = () => { res.send(JSON.stringify({ success: true })); };
    const error = (message) => { res.send(JSON.stringify({ success: false, message })); };
    parseJwt(req.body, (body, platformId) => {
        getCityId(body.ip,
            (cityId) => { saveData(cityId, platformId, body.user, body.data, success, error); },
            error);
        }, error);
});

app.listen(3000, () => {
    console.log('Server listening on port 3000');
});