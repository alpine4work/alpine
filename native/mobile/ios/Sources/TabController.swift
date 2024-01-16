import UIKit

class TabController: UIViewController {
    lazy private var label: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = title
        label.textColor = UIColor.black
        return label
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        self.view.backgroundColor = UIColor.white
        self.view.addSubview(self.label)
        self.setUpConstraints()
    }

    func setUpConstraints() {
        let labelConstraints = [
            self.label.centerXAnchor.constraint(equalTo: self.view.centerXAnchor),
            self.label.centerYAnchor.constraint(equalTo: self.view.centerYAnchor),
        ]
        NSLayoutConstraint.activate(labelConstraints)
    }
}
