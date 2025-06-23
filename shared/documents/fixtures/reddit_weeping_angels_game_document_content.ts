/* eslint-disable string-quotes */

import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

const schema = DocumentContentProsemirrorSchema;

/**
 * Reddit post about a Dr. Who Weeping Angels game.
 *
 * From the Reddit clustering dataset in the MTEB evaluation:
 * https://huggingface.co/datasets/mteb/reddit-clustering-p2p
 */
// NOTE(calebmer): This sounds so fun
export const redditWeepingAngelsGameDocumentContent = new Lazy(() =>
    assertDocumentContent(
        schema.node("doc", {}, [
            schema.node("title", {}, [
                schema.text("Im creating a custom tailored 1 shot about weeping angels"),
            ]),
            schema.node("paragraph", {}, [schema.text("I have a tldr at the bottom")]),
            schema.node("paragraph", {}, [
                schema.text(
                    "I have a group of 8 players, 2 of which are doctor who fans and im making a custom 1 shot for the 2 of them. Its gonna be a dream that they get a inspiration dice for if they survive and if they die i wont tell them what happens till after (they just wake up in the middle of the night and have to go back to sleep but they dont get the dice)",
                ),
            ]),
            schema.node("paragraph", {}, [
                schema.text(
                    "I figured they would lose so its more for the fun of experiencing it. Im on roll20 so ima make it so each person has a cone of vision and when they watch a weeping angle they must make a con save or blink(if they are in initiative).",
                ),
            ]),
            schema.node("paragraph", {}, [
                schema.text(
                    "I just wanted to hear some ideas on how to host a 2 player 1 shot like this. They players are not supposed to fight the monster and i dont know how to make them feel the terror and wanted to hear some ideas. (my idea was that if they get hit by the angle they age instead of life loss, age like 1d10 years and they lose some max hp. If they get hit too much they lose a death saving throw because they have gotten too weak from old age) (each of the players are humans in there mid 20s so they could get hit a few times but no one is gonna live for like 250 years)",
                ),
            ]),
            schema.node("paragraph", {}, [
                schema.text("I using the common weeping angels stat block but downscaled damage."),
            ]),
            schema.node("paragraph", {}, [
                schema.text(
                    "I want my players to feel the fear from this and just want to escape. My players will be level 4 or 3 (a arcane trickster rogue and a wild magic sorcerer ) They are not the tankiest that's why its ageing and not straight damage. The house is huge with lots of rooms, 2 stories and i have plans on a basement.  All rooms have 2 exits even if one is a window (on the main floor at least, not sure about basement and 2nd floor) so they can escape with still looking at it. The goal is to make it tight spaces so they cant just watch them from a far. Even in the quortyard there are trees blocking los but you can walk through the trees but you cant see far into them.",
                ),
            ]),
            schema.node("paragraph", {}, [schema.text("Idea of the adventure:")]),
            schema.node("paragraph", {}, [
                schema.text(
                    "I dont know yet why they are there or what the adventureers are ment to do fully. (My idea is that they get hired by a nobal in town to take them to this mention for friends lost note book. It will have no art but it will go on to talk about the statues moving. Then there is a smire of a pen mark like it got shaken or dropped when writing. At this point the nobal would wonder off and you would hear a scream. This would cause the characters to go looking and just see a statue where they did not before. No sign of the nobal. They would get sus at this point and try to leave and the door would be locked making them go out back and through the creepy forest to try and get back to town where the angles would stop fallowing. From here they would go into town and a new man would ask them to fallow him. When they do so he brings them to a man who is very simalar to the nobal they met a little bit ago. The man claims to be the same man and says that the angles took him. He asks for the note book which he then begins to draw in a picture of a weeping angle to stop other people from going out to look for them (if the players take the notebook and break it or burn it they wake up) and (if they players watch the man draw it out as a warning the man thanks them. I have them all make a perception check as the notebooks drops to the floor from the mans old age and the angles has moved covering more of the page reaching out, almost trying to escape, then the players wake up) They get the inspiration dice as concurring there fear or escaping the angles.",
                ),
            ]),
            schema.node("paragraph", {}, [
                schema.text(
                    "Tldr: How do you build suspense as a dungeon master? How do i make a foe so strong or scary that my players dont want to fight it but run instead just from meeting it?",
                ),
            ]),
        ]),
    ),
);
