var express = require('express');
var expressNunjucks = require('express-nunjucks');
var app = express();
var chokidar = require('chokidar');
var Promise = require('bluebird');
var mkdir = Promise.promisify(require('fs').mkdir);
var readFile = Promise.promisify(require('fs').readFile);
var readdir = require('fs').readdir;
var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var cam = require("raspicam");
var uuid = require('uuid/v1');

app.set('views',  __dirname + '/templates');

app.use(express.static('public'));

app.use(express.static('pics'));

var njk = expressNunjucks(app, {
    watch: true,
    noCache: true
});
 
app.get('/', (req, res) => {
	
	startStreaming();
    res.render('index');
	
});

app.get('/pictures', (req, res) => {

	stopStreaming();
	var pics = fs.readdirSync("./pics").filter(function(file) {
		return file.includes(".") && !file.includes("DS");
	});
	
	res.render('pics', {
		pics: pics
	});
});	
	
app.get('/pictures/:pic', (req, res) => {

	var dir = "./pics/" + req.params.pic + "/";
	
	var pics = fs.readdirSync(dir).filter(function(file) {
		return file.includes(".") && !file.includes("DS");
	});
	
	res.render('picture', {
		pics: pics,
		picture: req.params.pic
	});
	
});

app.get('/stream/start', (req, res) => {
    startStreaming();
	res.json();
});

app.get('/stream/stop', (req, res) => {
    stopStreaming();
	res.json();
});


app.get('/takePic', (req, res) => {
	var filename = uuid();
	var extension = ".jpg"
	var cmd = "wget http://localhost:8080/?action=snapshot -O " + __dirname + "/public/" + filename + extension;
	
	shell.exec(cmd, {silent: true}); // This can't be async.. otherwise the streaming stops and there's no image!
	
	stopStreaming();
	
	res.json({img : filename});
	
});

// These last two functions sure aren't safe... and it probably violates everything I've ever learned with programming,
// but this app won't be exposed outside the local environment.
app.get('/save/:pic', (req, res) => {
	console.log("Attempting to save temporary file.");
	shell.mv(__dirname + "/public/" + req.params.pic, __dirname + '/pics/');
	res.json();
});

app.get('/delete/:pic', (req, res) => {
	console.log("Removing temporary file.");
	shell.exec("rm ./public/" + req.params.pic, {silent:true});
	startStreaming();
	res.json();
	
});


// Our camera will send new photos to this directory. This will 'watch' that directory so we can start to process everytime a new photo is added.
var watcher = chokidar.watch('./pics', {
  persistent: true,
  ignoreInitial: true,
  depth: 0,
  ignored: '*.png' 
});



// This is where the magic happens. 
watcher.on('add', pathToFile => {
	
	if (pathToFile.includes('png')) {
		return;
	}
	
	var dirname = path.dirname(pathToFile);
	var basename = path.basename(pathToFile);
	var fileName = basename.substring(0, basename.indexOf("."));

	mkdir('./pics/' + fileName).then(function(contents) {
		console.log("Folder successfully made.");
		
		var fuzzpercent = 50;
		var destination= dirname + "/" + fileName;
		var rgbnum = "#44ff15";
		var output = destination + "/output.png";
		
		// Check the backgrounds directory and grab the name of each file.
		readdir("./backgrounds/", (err, files) => {
		
			// convert the image and remove the green screen.
			var cmd = 'convert ' + pathToFile + ' -fuzz "20%" -transparent "#44ff15" ' + output;
			shell.exec(cmd);	
	
			// Loop through each file in our sample directory and combine them!
			files.forEach((file, i, arr) => {
				
				var outputImage = destination + "/" + i + ".png";
				var background = "./backgrounds/" + file;
				var cmd = 'convert ' + background + ' ' + output + ' -gravity south -composite ' + outputImage
		
				shell.exec(cmd);
				console.log("Processing Image " + i + " of " + files.length);
		  	});
			
		});
	}).catch(function(err) {
		console.log(err);
	});
	
});




app.listen(3000, function() {
	console.log("Running!");
	startStreaming();
});

function startStreaming() {
  console.log("Attempting to start streaming");
  
  shell.exec("raspistill --nopreview -w 1920 -h 1080 -q 100 -o /tmp/stream/pic.jpg -tl 1 -t 9999999 -th 0:0:0 -br 60 &", {async:true, silent: true});
  console.log("raspistill started");
  shell.exec('LD_LIBRARY_PATH=/usr/local/lib mjpg_streamer -i "input_file.so -f /tmp/stream -n pic.jpg" -o "output_http.so -w /usr/local/www" &', {async:true, silent:true});
  console.log("mjpg_streamer started");

}

function stopStreaming() {
	// Kill the streamer to free up some processing power.
	shell.exec("pkill raspistill")
	shell.exec("pkill mjpg_streamer");
}
