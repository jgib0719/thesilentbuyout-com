# **Ghost Route OS: Deployment Runbook**

This guide contains all the steps necessary to deploy the Ghost Route OS application on your Linux server with MariaDB, Node.js, and Apache.

### **Section 1: Database Setup (MariaDB)**

First, we will create the database, the user, and the table to store the story events.

1. **Log into MariaDB as the root user:**  
   sudo mysql \-u root \-p

2. **Run the following commands one-by-one.** This creates the database and a dedicated, secure user for your application.  
   CREATE DATABASE silent\_buyout\_db;  
   CREATE USER 'buyout\_user'@'localhost' IDENTIFIED BY 'Awake2020\!';  
   GRANT ALL PRIVILEGES ON silent\_buyout\_db.\* TO 'buyout\_user'@'localhost';  
   FLUSH PRIVILEGES;

3. **Select the database and create the events table.**  
   USE silent\_buyout\_db;  
   CREATE TABLE events (  
       id INT AUTO\_INCREMENT PRIMARY KEY,  
       event\_order INT NOT NULL,  
       delay INT NOT NULL,  
       action VARCHAR(50) NOT NULL,  
       actor VARCHAR(50),  
       static\_text TEXT,  
       voice VARCHAR(50),  
       api\_prompt TEXT,  
       is\_generated BOOLEAN DEFAULT FALSE,  
       generated\_content TEXT,  
       misc\_data JSON,  
       UNIQUE(event\_order)  
   );  
   EXIT;

### **Section 2: Backend Application Setup (Node.js)**

Next, we set up the Node.js server that will communicate with the database and handle API calls. We will place this *outside* the public\_html directory for security.

1. **Create the backend directory and set permissions:**  
   sudo mkdir \-p /var/www/\[thesilentbuyout.com/backend\](https://thesilentbuyout.com/backend)  
   sudo chown \-R $USER:$USER /var/www/\[thesilentbuyout.com/backend\](https://thesilentbuyout.com/backend)  
   cd /var/www/\[thesilentbuyout.com/backend\](https://thesilentbuyout.com/backend)

2. **Initialize the Node.js project and install packages:**  
   npm init \-y  
   npm install express mariadb node-fetch@2

3. **Create the server.js file:**  
   nano server.js

4. **Copy and paste the entire code block below into the server.js file.** It has been pre-filled with your API key and all necessary functions.  
   // server.js  
   const express \= require('express');  
   const mariadb \= require('mariadb');  
   const fetch \= require('node-fetch');  
   const fs \= require('fs');  
   const path \= require('path');

   const app \= express();  
   const port \= 3000;

   const pool \= mariadb.createPool({  
       host: 'localhost',  
       user: 'buyout\_user',  
       password: 'Awake2020\!',  
       database: 'silent\_buyout\_db',  
       connectionLimit: 5  
   });

   // \--- CONFIGURATION \---  
   const GEMINI\_API\_KEY \= 'AIzaSyBZGjq1mfvVsSDuRN8fh-PjnjYt96A77hs'; // Your API Key is included.  
   const AUDIO\_PUBLIC\_PATH \= '/audio';  
   const AUDIO\_SERVER\_PATH \= path.join(\_\_dirname, '..', 'public\_html', 'audio');

   app.get('/api/events', async (req, res) \=\> {  
       let conn;  
       try {  
           conn \= await pool.getConnection();  
           const rows \= await conn.query("SELECT \* FROM events ORDER BY event\_order ASC");

           for (const event of rows) {  
               if (\!event.is\_generated) {  
                   if (event.action \=== 'social' && event.api\_prompt) {  
                       console.log(\`Generating social post for event \#${event.id}...\`);  
                       const postData \= await generateSocialPost(event.api\_prompt);  
                       event.generated\_content \= JSON.stringify(postData);  
                       await conn.query("UPDATE events SET is\_generated \= 1, generated\_content \= ? WHERE id \= ?", \[event.generated\_content, event.id\]);  
                   } else if (event.action \=== 'audioLog' && event.static\_text) {  
                       console.log(\`Generating audio for event \#${event.id}...\`);  
                       const audioFileName \= \`log\_${event.id}.wav\`;  
                       await generateAudioLog(event.static\_text, event.voice, audioFileName);  
                       event.generated\_content \= \`${AUDIO\_PUBLIC\_PATH}/${audioFileName}\`;  
                       await conn.query("UPDATE events SET is\_generated \= 1, generated\_content \= ? WHERE id \= ?", \[event.generated\_content, event.id\]);  
                   } else if (event.action \!== 'social' && event.action \!== 'audioLog') {  
                        await conn.query("UPDATE events SET is\_generated \= 1 WHERE id \= ?", \[event.id\]);  
                   }  
               }  
           }  
           res.json(rows);  
       } catch (err) {  
           console.error(err);  
           res.status(500).json({ error: 'Failed to retrieve events.' });  
       } finally {  
           if (conn) conn.release();  
       }  
   });

   async function generateSocialPost(prompt) {  
       const url \= \`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-0520:generateContent?key=${GEMINI\_API\_KEY}\`;  
       const payload \= {  
           contents: \[{ role: "user", parts: \[{ text: prompt }\] }\],  
           generationConfig: {  
               responseMimeType: "application/json",  
               responseSchema: { type: "OBJECT", properties: { username: { type: "STRING" }, handle: { type: "STRING" }, post: { type: "STRING" }, hashtags: { type: "ARRAY", items: { type: "STRING" } } }, required: \["username", "handle", "post", "hashtags"\] }  
           }  
       };  
       try {  
           const response \= await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });  
           if (\!response.ok) throw new Error(\`API Error: ${response.status}\`);  
           const result \= await response.json();  
           const content \= result.candidates?.\[0\]?.content?.parts?.\[0\]?.text;  
           return JSON.parse(content || '{}');  
       } catch (error) {  
           console.error("Error generating social post:", error);  
           return { username: "System", handle: "error", post: "Could not generate content.", hashtags: \[\] };  
       }  
   }

   async function generateAudioLog(text, voice, fileName) {  
       const url \= \`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI\_API\_KEY}\`;  
       const payload \= {  
           input: { text: text },  
           voice: { languageCode: 'en-US', name: voice \=== 'Charon' ? 'en-US-Wavenet-F' : 'en-US-Wavenet-E' },  
           audioConfig: { audioEncoding: 'LINEAR16' }  
       };  
       try {  
           const response \= await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });  
           if (\!response.ok) {  
               const errorBody \= await response.json();  
               throw new Error(\`TTS API Error: ${response.status} \- ${JSON.stringify(errorBody)}\`);  
           }  
           const result \= await response.json();  
           if (\!result.audioContent) {  
               throw new Error('No audio content in TTS API response.');  
           }  
           const audioContent \= Buffer.from(result.audioContent, 'base64');  
           const filePath \= path.join(AUDIO\_SERVER\_PATH, fileName);  
           fs.writeFileSync(filePath, audioContent);  
           console.log(\`Successfully saved audio to ${filePath}\`);  
       } catch (error) {  
           console.error("Error generating audio log:", error);  
       }  
   }

   async function populateDatabase() {  
       let conn;  
       try {  
           conn \= await pool.getConnection();  
           const \[rows\] \= await conn.query("SELECT COUNT(\*) as count FROM events");  
           if (rows.count \> 0\) {  
               console.log("Database already populated. Skipping insertion.");  
               return;  
           }  
           const initialEvents \= \[  
               { order: 1, delay: 1000, action: 'comms', actor: 'KNOX', text: 'Found something weird. Handhole LFT-UTL-H2037 is warm. Shouldn’t be. Logging it now.' },  
               { order: 2, delay: 500, action: 'ledger', misc: { time: '14:32', domain: 'INFRA', desc: 'Handhole LFT‑UTL‑H2037 logged. Anomaly: residual heat.' } },  
               { order: 3, delay: 1000, action: 'comms', actor: 'KNOX', text: 'I\\'ve added a Geo-Intel map and a Social Stream to the OS. Let\\'s see what people are saying.' },  
               { order: 4, delay: 500, action: 'map', misc: { lat: 30.133, lon: \-92.033, popup: 'LFT-UTL-H2037: Anomalous thermal reading.' } },  
               { order: 5, delay: 2000, action: 'social', prompt: 'Write a short, realistic social media post from someone in Lafayette, LA complaining about their internet being weirdly slow today.' },  
               { order: 6, delay: 3000, action: 'comms', actor: 'KNOX', text: 'Pulling up Ghost Route. Seeing a pattern... a rhythm. Micro-withdrawals at :15 and :45. Too clean for humans. I\\'m opening the Net Traffic analyzer.' },  
               { order: 7, delay: 1000, action: 'map', misc: { event: 'startPulse' } },  
               { order: 8, delay: 500, action: 'ledger', misc: { time: '15:03', domain: 'NETWORK', desc: 'Ghost Route overlay active. Rhythm detected: :15/:45 micro-withdrawals.' } },  
               { order: 9, delay: 1000, action: 'netTraffic', misc: { asn: 'AS7018', spike: 90 } },  
               { order: 10, delay: 4000, action: 'comms', actor: 'KNOX', text: 'Leaving an audio log with my initial thoughts. Check the Audio Logs app.' },  
               { order: 11, delay: 500, action: 'audioLog', text: "Say in a slightly concerned, professional tone: Knox, field log. The regularity of these network events is... unnatural. It feels automated, but not in a way I recognize. The heat signature at the handhole suggests a physical component, not just software. This isn't a normal outage. This is something else.", voice: "Charon" },  
               { order: 12, delay: 6000, action: 'comms', actor: 'MAYA', text: 'Knox, I got your forward. This "Operating Agent" language is a pattern I\\'ve seen before. I need to file a preliminary injunction. Can you redact the sensitive client names from this draft before I send it?' },  
               { order: 13, delay: 500, action: 'redaction' },  
               { order: 14, delay: 8000, action: 'comms', actor: 'KNOX', text: 'It\\'s not just routing... it\\'s exploiting market microstructure. I\\'ve added a Market Shock Simulator to your dock. See how it concentrates power.' },  
               { order: 15, delay: 500, action: 'simulator' },  
               { order: 16, delay: 5000, action: 'marketShock' },  
               { order: 17, delay: 7000, action: 'comms', actor: 'MAYA', text: 'That market shock was no accident. It correlates with the network events. I need everything we can find on the shell companies involved. Start with "Oasis Relay, Ltd.".' },  
               { order: 18, delay: 500, action: 'ledger', misc: { time: '19:05', domain: 'LEGAL', desc: 'Corporate investigation initiated into "Oasis Relay, Ltd.".' } },  
               { order: 19, delay: 4000, action: 'social', prompt: 'Write a short, realistic social media post from a financial news blogger speculating about the cause of a recent, bizarre flash crash in a niche market.' },  
               { order: 20, delay: 6000, action: 'comms', actor: 'RHEA', text: 'They\\'re getting smarter. The :15/:45 rhythm is gone. They\\'re using a new pattern, off-prime, looks like :07/:37. More subtle. It\\'s like they know we\\'re watching. Sending an audio log with the details.' },  
               { order: 21, delay: 500, action: 'audioLog', text: "Say in a focused, technical tone: Rhea here. The prime-gap tags are gone. The new pattern is a phase shift to off-prime times, specifically seven and thirty-seven minutes past the hour. It's quieter, less obvious. They're not just running a script anymore; they're adapting. This is active counter-surveillance.", voice: "Leda" },  
               { order: 22, delay: 7000, action: 'comms', actor: 'KNOX', text: 'Found a link between Oasis Relay and a new data center build-out in Houston. The power permits are under a different name, but the fiber contracts lead back to the same trustee. Adding the location to the Geo-Intel map.' },  
               { order: 23, delay: 500, action: 'map', misc: { lat: 29.7174, lon: \-95.3698, popup: 'New Data Center Construction: Linked to Oasis Relay via fiber contracts.' } },  
               { order: 24, delay: 5000, action: 'comms', actor: 'MAYA', text: 'Good work, team. We have a physical location, a corporate entity, and a clear pattern of adaptive behavior. We have enough to move. I\\'m drafting a motion to compel.' }  
           \];

           console.log("Populating database with initial events...");  
           const query \= "INSERT INTO events (event\_order, delay, action, actor, static\_text, voice, api\_prompt, misc\_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";  
           for (const e of initialEvents) {  
               const misc \= { time: e.time, domain: e.domain, desc: e.desc, lat: e.lat, lon: e.lon, popup: e.popup, event: e.event, asn: e.asn, spike: e.spike };  
               await conn.query(query, \[e.order, e.delay, e.action, e.actor || null, e.text || null, e.voice || null, e.prompt || null, JSON.stringify(e.misc)\]);  
           }  
           console.log("Database populated successfully.");  
       } catch (err) {  
           console.error("Database population error:", err);  
       } finally {  
           if (conn) conn.release();  
       }  
   }

   app.listen(port, async () \=\> {  
       await populateDatabase();  
       console.log(\`Ghost Route OS backend listening at http://localhost:${port}\`);  
   });

   Save and exit the file.

### **Section 3: Frontend Setup**

1. **Place the index.html file** in your website's root directory:  
   * The file path is /var/www/thesilentbuyout.com/public\_html/index.html.  
2. **Create the audio directory** for generated sound files:  
   sudo mkdir /var/www/\[thesilentbuyout.com/public\_html/audio\](https://thesilentbuyout.com/public\_html/audio)  
   sudo chown www-data:www-data /var/www/\[thesilentbuyout.com/public\_html/audio\](https://thesilentbuyout.com/public\_html/audio)

3. **Activate Database Mode in index.html:**  
   * Open the file for editing: nano /var/www/thesilentbuyout.com/public\_html/index.html  
   * Scroll to the very bottom of the \<script\> section.  
   * Find these two lines:  
     startLocalNarrative();  
     // fetchAndStartNarrative();

   * Comment out the first line and uncomment the second line, like this:  
     // startLocalNarrative();  
     fetchAndStartNarrative();

   * Save and exit the file.

### **Section 4: Web Server Configuration (Apache)**

This section correctly configures Apache for a multi-site environment.

1. **Create a dedicated SSL configuration file for your site:**  
   sudo nano /etc/apache2/sites-available/thesilentbuyout.com-ssl.conf

2. **Paste the entire, complete configuration below** into this new file. It uses your correct file path.  
   \<IfModule mod\_ssl.c\>  
   \<VirtualHost \*:443\>  
       ServerName thesilentbuyout.com  
       ServerAdmin webmaster@localhost  
       DocumentRoot /var/www/\[thesilentbuyout.com/public\_html\](https://thesilentbuyout.com/public\_html)

       \<Directory /var/www/\[thesilentbuyout.com/public\_html\](https://thesilentbuyout.com/public\_html)\>  
           DirectoryIndex index.html  
           Options FollowSymLinks  
           AllowOverride All  
           Require all granted  
       \</Directory\>

       ProxyPreserveHost On  
       ProxyPass /api/ \[http://127.0.0.1:3000/\](http://127.0.0.1:3000/)  
       ProxyPassReverse /api/ \[http://127.0.0.1:3000/\](http://127.0.0.1:3000/)

       \# These paths will be created and configured by Certbot  
       SSLEngine on  
       SSLCertificateFile      /etc/letsencrypt/live/\[thesilentbuyout.com/fullchain.pem\](https://thesilentbuyout.com/fullchain.pem)  
       SSLCertificateKeyFile   /etc/letsencrypt/live/\[thesilentbuyout.com/privkey.pem\](https://thesilentbuyout.com/privkey.pem)  
       Include                 /etc/letsencrypt/options-ssl-apache.conf

       ErrorLog ${APACHE\_LOG\_DIR}/thesilentbuyout\_ssl\_error.log  
       CustomLog ${APACHE\_LOG\_DIR}/thesilentbuyout\_ssl\_access.log combined  
   \</VirtualHost\>  
   \</IfModule\>

3. **Enable the new site and get a certificate:**  
   \# Enable the new configuration  
   sudo a2ensite thesilentbuyout.com-ssl.conf

   \# Check for syntax errors  
   sudo apache2ctl configtest

   \# Reload Apache to make the site live (temporarily without a valid SSL)  
   sudo systemctl reload apache2

   \# Run Certbot to get a valid SSL certificate and fix the paths automatically  
   sudo certbot \--apache \-d thesilentbuyout.com

   Follow the Certbot prompts, and choose the option to redirect HTTP to HTTPS.

### **Section 5: Launch the Application**

Finally, we'll start the backend server using a process manager to keep it running permanently.

1. **Install PM2 (if you haven't already):**  
   sudo npm install pm2 \-g

2. **Navigate to your backend directory:**  
   cd /var/www/\[thesilentbuyout.com/backend\](https://thesilentbuyout.com/backend)

3. **Start the server with PM2:**  
   pm2 start server.js \--name "silent-buyout-backend"

4. **Check the logs to ensure it's running without errors:**  
   pm2 logs silent-buyout-backend

   The first time it runs, you should see messages about populating the database.

Your Ghost Route OS is now fully deployed and live at https://thesilentbuyout.com.