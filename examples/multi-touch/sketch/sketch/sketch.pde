import oscP5.*;
import netP5.*;

int serverOSCPort = 9000;
int appPort = 9001;
String serverIP = "127.0.0.1";
int maxTouches = 20;

OscP5 oscP5;
NetAddress rhizomeLocation;
ArrayList<Device> devices;

void setup() {
  size(1024, 576);
  frameRate(60);
  strokeWeight(5);
  ellipseMode(CENTER);
  devices = new ArrayList<Device>();

  oscP5 = new OscP5(this, appPort);
  rhizomeLocation = new NetAddress(serverIP, serverOSCPort);

  OscMessage subscribeMsg = new OscMessage("/sys/subscribe");
  subscribeMsg.add(appPort);
  subscribeMsg.add("/touches");
  oscP5.send(subscribeMsg, rhizomeLocation);
}

void draw() {
  background(0);
  for (int i = 0; i<devices.size(); i++) {
    devices.get(i).display();
  }
}

void oscEvent(OscMessage msg) {
  if (msg.addrPattern().equals("/touches")) {
    String id = msg.get(0).stringValue();

    //check if new mobile detected
    Device dev = null;
    for (int i = 0; i<devices.size(); i++) {
      if (devices.get(i).id.equals(id)) {
        dev = devices.get(i);
      }
    }

    //create new if not already present
    if (dev==null) {
      dev = new Device(id);
      devices.add(dev);
    }

    //update touch points
    dev.numTouches = min(maxTouches, msg.typetag().length()-1);
    for (int i = 0; i<dev.numTouches; i++) {
      dev.touches[i] = msg.get(i+1).floatValue();
    }
    
  } else if (msg.addrPattern().equals("/sys/subscribed")) {
    println("subscribed successfully to /touches");
    
  } else {
    println("unexpected message received " + msg.addrPattern());
  }
}

class Device {
  String id;
  float[] touches;
  int numTouches;
  color bgCol, fgCol;

  Device(String _id) {
    id = _id;
    touches = new float[maxTouches*2];
    numTouches = 0;
    bgCol = color(int(id.charAt(0))*25%256, int(id.charAt(1))*25%256, int(id.charAt(2))*25%256);
    fgCol = color(int(id.charAt(3))*25%256, int(id.charAt(4))*25%256, int(id.charAt(5))*25%256);
  }

  void display() {
    stroke(fgCol);
    fill(bgCol);
    for (int i = 0; i<min(numTouches, maxTouches)/2; i++) {
      int x = int(touches[i*2]*width);
      int y = int(touches[i*2+1]*height);
      ellipse(x, y, 40, 40);
    }
  }
}